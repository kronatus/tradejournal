// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest, type McpDeps } from "./server";
import type { MarketStore, ResearchStore } from "@/lib/research-store";
import type { MarketBar, MarketScanRow } from "@/lib/types";
import type { ScanDigest } from "@/lib/market-scan";
import fixture from "@/tests/fixtures/ticker-report-aapl.json";

const SECRET = "s".repeat(43);
const USER = "user-1";

function memoryDeps(opts: { scan?: MarketScanRow | null; bars?: MarketBar[]; refreshError?: string } = {}) {
  const saved: { reports: unknown[]; sweeps: unknown[]; tickers: Record<string, unknown>[] } = {
    reports: [],
    sweeps: [],
    tickers: [],
  };
  const research: ResearchStore = {
    listTickers: async () => [
      { id: "1", user_id: USER, symbol: "AAPL", sector: "Information Technology", industry: null, setup: null, notes: null, sort_order: 0, added_by: "user", created_at: "", updated_at: "", latest_report_at: "2026-11-01T00:00:00Z" },
    ],
    addTicker: async (input, addedBy) => {
      const t = { id: "t", user_id: USER, setup: null, sort_order: 0, created_at: "", updated_at: "", ...input, sector: input.sector ?? null, industry: input.industry ?? null, notes: input.notes ?? null, added_by: addedBy };
      saved.tickers.push(t);
      return t;
    },
    removeTicker: async () => true,
    getLatestReport: async () => null,
    saveReport: async (r) => {
      saved.reports.push(r);
      return { id: "rep-1", created_at: "2026-11-08T00:00:00Z" };
    },
    listSweeps: async () => [],
    postSweep: async (s) => {
      saved.sweeps.push(s);
      return { id: "sw-1", created_at: "2026-11-08T00:00:00Z" };
    },
    listOpenPositions: async () => [],
  };
  const market: MarketStore = {
    lastStoredDate: async () => null,
    storedDates: async () => new Set(),
    latestScanDate: async () => null,
    keepSymbols: async () => new Set(),
    upsertBars: async () => {},
    loadBars: async (_f, _t, symbols) => (opts.bars ?? []).filter((b) => !symbols || symbols.includes(b.symbol)),
    saveScan: async () => {},
    getScan: async () => opts.scan ?? null,
    listScanDates: async () => [],
  };
  const deps: McpDeps = {
    research,
    market,
    refreshMarket: vi.fn(async () => {
      if (opts.refreshError) throw new Error(opts.refreshError);
      return { planned: [], ingested: [], empty: [], scanned: [], stoppedEarly: null };
    }),
    now: () => new Date("2026-11-08T15:00:00Z"),
  };
  return { deps, saved };
}

let nextId = 1;
async function rpc(deps: McpDeps, method: string, params: unknown = {}, secret = SECRET) {
  const res = await handleMcpRequest(
    new Request("http://localhost/api/mcp/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
    {
      secret,
      resolveUser: async (s) => (s === SECRET ? USER : null),
      makeDeps: () => deps,
    }
  );
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

const call = (deps: McpDeps, name: string, args: unknown = {}) =>
  rpc(deps, "tools/call", { name, arguments: args });

function toolJson(r: { body: { result: { content: { text: string }[] } } }) {
  return JSON.parse(r.body.result.content[0].text);
}

describe("MCP HTTP transport", () => {
  it("initializes with server info and usage instructions", async () => {
    const { deps } = memoryDeps();
    const r = await rpc(deps, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe("trade-journal-research");
    expect(r.body.result.instructions).toMatch(/integer cents/);
  });

  it("lists every research tool with a JSON schema", async () => {
    const { deps } = memoryDeps();
    const r = await rpc(deps, "tools/list");
    const tools = r.body.result.tools as { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_research_ticker",
      "get_market_scan",
      "get_symbol_detail",
      "get_ticker_report",
      "list_market_sweeps",
      "list_open_positions",
      "list_research_tickers",
      "post_market_sweep",
      "refresh_market_data",
      "remove_research_ticker",
      "save_ticker_report",
    ]);
    const save = tools.find((t) => t.name === "save_ticker_report")!;
    expect(Object.keys(save.inputSchema.properties!)).toEqual(
      expect.arrayContaining(["symbol", "snapshot", "technicals", "articles"])
    );
    expect(save.inputSchema.properties).not.toHaveProperty("strategies");
  });

  it("answers 404 for an unknown connector secret without building a server", async () => {
    const makeDeps = vi.fn();
    const res = await handleMcpRequest(
      new Request("http://localhost/api/mcp/x", { method: "POST", body: "{}" }),
      { secret: "nope", resolveUser: async () => null, makeDeps }
    );
    expect(res.status).toBe(404);
    expect(makeDeps).not.toHaveBeenCalled();
  });

  it("rejects GET (no server-initiated stream in stateless mode)", async () => {
    const res = await handleMcpRequest(new Request("http://localhost/api/mcp/x"), {
      secret: SECRET,
      resolveUser: async () => USER,
      makeDeps: () => memoryDeps().deps,
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("save_ticker_report", () => {
  it("validates, normalises, defaults classification and saves", async () => {
    const { deps, saved } = memoryDeps();
    const r = await call(deps, "save_ticker_report", { ...fixture, sector: undefined, industry: undefined });
    expect(r.body.result.isError).toBeFalsy();
    expect(toolJson(r)).toMatchObject({ id: "rep-1", view: "/research?symbol=AAPL" });
    const report = saved.reports[0] as { symbol: string; sector: string };
    expect(report.symbol).toBe("AAPL");
    expect(report.sector).toBe("Information Technology"); // from the universe
  });

  it("rejects fractional cents with an error Claude can act on", async () => {
    const { deps, saved } = memoryDeps();
    const bad = structuredClone(fixture);
    bad.snapshot.price_cents = 342.65;
    const r = await call(deps, "save_ticker_report", bad);
    const failed = r.body.error || r.body.result?.isError;
    expect(failed).toBeTruthy();
    expect(JSON.stringify(r.body)).toMatch(/price_cents/);
    expect(saved.reports).toHaveLength(0);
  });

  it("rejects articles dated after the report", async () => {
    const { deps, saved } = memoryDeps();
    const r = await call(deps, "save_ticker_report", {
      ...fixture,
      articles: [{ ...fixture.articles[0], published_at: "2026-11-10T00:00:00Z" }],
    });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/after as_of/);
    expect(saved.reports).toHaveLength(0);
  });
});

describe("market tools", () => {
  const digest = { scan_date: "2026-11-06", weighting: "equal", anomalies: [] } as unknown as ScanDigest;
  const scan: MarketScanRow = { scan_date: "2026-11-06", computed_at: "2026-11-07T11:00:00Z", weighting: "equal", digest };

  it("returns the stored scan even when the top-up fails", async () => {
    const { deps } = memoryDeps({ scan, refreshError: "MASSIVE_API_KEY is not set" });
    const r = await call(deps, "get_market_scan");
    const body = toolJson(r);
    expect(body.scan_date).toBe("2026-11-06");
    expect(body.refresh).toEqual({ error: "MASSIVE_API_KEY is not set" });
  });

  it("does not top up when a specific date is requested", async () => {
    const { deps } = memoryDeps({ scan });
    await call(deps, "get_market_scan", { date: "2026-11-06" });
    expect(deps.refreshMarket).not.toHaveBeenCalled();
  });

  it("explains how to get data when no scan exists", async () => {
    const { deps } = memoryDeps({ scan: null });
    const r = await call(deps, "get_market_scan");
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/not been ingested/);
  });

  it("computes symbol detail from stored bars and reports misses", async () => {
    const bars: MarketBar[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      symbol: "AAPL",
      open_cents: 30000 + i * 10,
      high_cents: 30100 + i * 10,
      low_cents: 29900 + i * 10,
      close_cents: 30000 + i * 10,
      vwap_cents: null,
      volume: 1_000_000,
    }));
    const { deps } = memoryDeps({ bars });
    const body = toolJson(await call(deps, "get_symbol_detail", { symbols: ["aapl", "zzzz"] }));
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ symbol: "AAPL", sector: "Information Technology" });
    expect(body.results[0].technicals.sma20_cents).toBe(30195);
    expect(body.results[0].recent_bars).toHaveLength(10);
    expect(body.not_found).toEqual(["ZZZZ"]);
    expect(body.hint).toMatch(/Robinhood/);
  });
});

describe("sweep news", () => {
  const base = {
    as_of: "2026-11-07T21:00:00Z",
    headline: "Semis lead",
    regime: "rotation",
    summary: "Tech carried the tape.",
  };
  const item = {
    title: "Chipmaker beats and raises",
    url: "https://example.com/chip",
    source: "Example Wire",
    published_at: "2026-11-07T13:00:00Z",
    impact: "stock",
    symbols: ["nvda"],
  };

  it("saves headlines of the day with the sweep", async () => {
    const { deps, saved } = memoryDeps();
    const r = await call(deps, "post_market_sweep", { ...base, news: [item] });
    expect(r.body.result.isError).toBeFalsy();
    const news = (saved.sweeps[0] as { news: { symbols: string[]; summary: string }[] }).news;
    expect(news[0].symbols).toEqual(["NVDA"]);
    expect(news[0].summary).toBe("");
  });

  it("rejects stale news with a message Claude can act on", async () => {
    const { deps, saved } = memoryDeps();
    const r = await call(deps, "post_market_sweep", {
      ...base,
      news: [{ ...item, published_at: "2026-11-04T13:00:00Z" }],
    });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toMatch(/older than 36h/);
    expect(saved.sweeps).toHaveLength(0);
  });
});

describe("research list and sweeps", () => {
  it("lists tickers with freshness", async () => {
    const { deps } = memoryDeps();
    const body = toolJson(await call(deps, "list_research_tickers"));
    expect(body).toEqual([expect.objectContaining({ symbol: "AAPL", freshness: "stale" })]);
  });

  it("adds a ticker with universe classification", async () => {
    const { deps, saved } = memoryDeps();
    await call(deps, "add_research_ticker", { symbol: "nvda" });
    expect(saved.tickers[0]).toMatchObject({ symbol: "NVDA", sector: "Information Technology", added_by: "claude" });
  });

  it("posts a sweep", async () => {
    const { deps, saved } = memoryDeps();
    const r = await call(deps, "post_market_sweep", {
      as_of: "2026-11-07T21:00:00Z",
      scan_date: "2026-11-06",
      headline: "Semis lead",
      regime: "rotation",
      summary: "Tech carried the tape.",
      picks: [{ symbol: "amd", direction: "bullish", horizon: "weeks", signal: "REL_VOL", thesis: "Volume breakout." }],
    });
    expect(toolJson(r)).toMatchObject({ id: "sw-1", view: "/pulse" });
    expect((saved.sweeps[0] as { picks: { symbol: string }[] }).picks[0].symbol).toBe("AMD");
  });
});
