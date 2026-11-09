// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMarketStore,
  createResearchStore,
  hashToken,
  newTokenSecret,
  resolveMcpToken,
} from "./research-store";
import fixture from "@/tests/fixtures/ticker-report-aapl.json";
import { MarketSweepInputSchema, TickerReportInputSchema } from "./schemas";

type Op = { method: string; args: unknown[] };
type Call = { table: string; ops: Op[] };
type Resolver = (call: Call) => { data: unknown; error: { message: string } | null };

/**
 * A minimal stand-in for the supabase-js query builder: records every chained
 * call and resolves (when awaited) through `resolve`, so tests can assert on
 * the exact filters each store method applies.
 */
function fakeDb(resolve: Resolver) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        call.ops.push({ method, args });
        return builder;
      };
      for (const m of [
        "select", "insert", "update", "upsert", "delete", "eq", "in", "is",
        "gte", "lte", "order", "limit", "range", "single", "maybeSingle",
      ]) {
        builder[m] = chain(m);
      }
      builder.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
        Promise.resolve(resolve(call)).then(ok, fail);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const U = "user-1";
const has = (call: Call, method: string, ...args: unknown[]) =>
  call.ops.some((o) => o.method === method && JSON.stringify(o.args) === JSON.stringify(args));
const USER_TABLES = new Set(["research_tickers", "ticker_reports", "market_sweeps", "strategies", "strategy_sets"]);

function assertUserScoped(calls: Call[]) {
  for (const c of calls.filter((c) => USER_TABLES.has(c.table))) {
    const insert = c.ops.find((o) => o.method === "insert");
    if (insert) {
      expect((insert.args[0] as { user_id: string }).user_id).toBe(U);
    } else {
      expect(has(c, "eq", "user_id", U), `${c.table}: ${JSON.stringify(c.ops)}`).toBe(true);
    }
  }
}

describe("createResearchStore", () => {
  it("scopes every query and insert to the user", async () => {
    const { db, calls } = fakeDb((call) => {
      const single = call.ops.some((o) => o.method === "single" || o.method === "maybeSingle");
      if (call.table === "research_tickers" && single) {
        return { data: { id: "t1", symbol: "AAPL", sector: null, industry: null, notes: null }, error: null };
      }
      return { data: single ? { id: "x", created_at: "now" } : [], error: null };
    });
    const store = createResearchStore(db, U);
    await store.listTickers();
    await store.addTicker({ symbol: "AAPL", sector: "Information Technology" }, "user");
    await store.removeTicker("AAPL");
    await store.getLatestReport("AAPL");
    await store.saveReport(TickerReportInputSchema.parse(fixture));
    await store.listSweeps(3);
    await store.postSweep(
      MarketSweepInputSchema.parse({ as_of: "2026-11-07T21:00:00Z", headline: "h", regime: "neutral", summary: "s" })
    );
    await store.listOpenPositions();
    await store.getLatestStrategySet("AAPL");
    await store.saveStrategySet({
      symbol: "AAPL",
      as_of: "2026-11-09T15:00:00Z",
      horizons: ["long"],
      reference_price_cents: 10000,
      reference_at: "2026-11-09T15:00:00Z",
      account_value_cents: 1_000_000,
      regime: {},
      ideas: [],
      no_setup_reason: "nothing cleared the gate",
      rejected_summary: { evaluated: 0, passed: 0, rejected: {} },
      model_notes: null,
    });
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.some((c) => c.table === "strategy_sets")).toBe(true);
    assertUserScoped(calls);
  });

  it("merges each ticker's latest report time", async () => {
    const { db } = fakeDb((call) => {
      if (call.table === "research_tickers") {
        return { data: [{ symbol: "AAPL" }, { symbol: "MSFT" }], error: null };
      }
      return {
        data: [
          { symbol: "AAPL", as_of: "2026-11-07T00:00:00Z" },
          { symbol: "AAPL", as_of: "2026-11-01T00:00:00Z" },
        ],
        error: null,
      };
    });
    const list = await createResearchStore(db, U).listTickers();
    expect(list.map((t) => [t.symbol, t.latest_report_at])).toEqual([
      ["AAPL", "2026-11-07T00:00:00Z"],
      ["MSFT", null],
    ]);
  });

  it("only fills classification gaps on an existing ticker", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.ops.some((o) => o.method === "maybeSingle")) {
        return { data: { id: "t1", symbol: "AAPL", sector: "Tech", industry: null, notes: null }, error: null };
      }
      return { data: { id: "t1" }, error: null };
    });
    await createResearchStore(db, U).addTicker({ symbol: "AAPL", sector: "Other", industry: "Hardware" }, "claude");
    const update = calls.flatMap((c) => c.ops).find((o) => o.method === "update")!;
    expect(update.args[0]).toMatchObject({ industry: "Hardware" });
    expect(update.args[0]).not.toHaveProperty("sector");
  });

  it("drops closed legs and fully closed strategies from open positions", async () => {
    const { db } = fakeDb(() => ({
      data: [
        { id: "s1", underlying: "SPY", strategy_kind: "vertical", opened_at: "x", legs: [
          { occ_symbol: "A", exit_price_cents: null, qty: 1 },
          { occ_symbol: "B", exit_price_cents: 100, qty: 1 },
        ] },
        { id: "s2", underlying: "QQQ", strategy_kind: "long_call", opened_at: "x", legs: [
          { occ_symbol: "C", exit_price_cents: 5, qty: 1 },
        ] },
      ],
      error: null,
    }));
    const open = await createResearchStore(db, U).listOpenPositions();
    expect(open).toHaveLength(1);
    expect(open[0].legs.map((l) => l.occ_symbol)).toEqual(["A"]);
    expect(open[0].legs[0]).not.toHaveProperty("exit_price_cents");
  });

  it("surfaces database errors", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "relation does not exist" } }));
    await expect(createResearchStore(db, U).listSweeps(1)).rejects.toThrow("relation does not exist");
  });
});

describe("createMarketStore", () => {
  it("paginates bar loads past the 1000-row response cap", async () => {
    const { db, calls } = fakeDb((call) => {
      const range = call.ops.find((o) => o.method === "range")!.args as [number, number];
      const n = range[0] === 0 ? 1000 : 5;
      return { data: Array.from({ length: n }, () => ({ symbol: "A" })), error: null };
    });
    const rows = await createMarketStore(db).loadBars("2026-08-01", "2026-11-06");
    expect(rows).toHaveLength(1005);
    expect(calls).toHaveLength(2);
    expect(has(calls[0], "gte", "date", "2026-08-01")).toBe(true);
  });

  it("upserts bars in chunks on the (date, symbol) key", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const bar = { date: "d", symbol: "s", open_cents: 1, high_cents: 1, low_cents: 1, close_cents: 1, vwap_cents: null, volume: 1 };
    await createMarketStore(db).upsertBars(new Array(1500).fill(bar));
    expect(calls).toHaveLength(2);
    expect(calls[0].ops[0]).toMatchObject({ method: "upsert" });
    expect(calls[0].ops[0].args[1]).toEqual({ onConflict: "date,symbol" });
  });

  it("keeps the universe plus every research ticker", async () => {
    const { db } = fakeDb(() => ({ data: [{ symbol: "TINYCO" }], error: null }));
    const keep = await createMarketStore(db).keepSymbols();
    expect(keep.has("TINYCO")).toBe(true);
    expect(keep.has("AAPL")).toBe(true);
    expect(keep.has("SPY")).toBe(true);
  });
});

describe("mcp tokens", () => {
  it("hashes with sha256", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("generates url-safe 256-bit secrets", () => {
    const a = newTokenSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newTokenSecret()).not.toBe(a);
  });

  it("rejects malformed secrets without touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    expect(await resolveMcpToken(db, "short")).toBeNull();
    expect(await resolveMcpToken(db, "has spaces and is long enough to pass length")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("looks up by hash, ignores revoked tokens, and stamps last use", async () => {
    const secret = newTokenSecret();
    const { db, calls } = fakeDb((call) =>
      call.ops.some((o) => o.method === "maybeSingle")
        ? { data: { id: "tok", user_id: U }, error: null }
        : { data: null, error: null }
    );
    expect(await resolveMcpToken(db, secret)).toBe(U);
    expect(has(calls[0], "eq", "token_hash", await hashToken(secret))).toBe(true);
    expect(has(calls[0], "is", "revoked_at", null)).toBe(true);
    expect(calls[1].ops[0].method).toBe("update");
  });

  it("returns null for an unknown token", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    expect(await resolveMcpToken(db, newTokenSecret())).toBeNull();
  });
});
