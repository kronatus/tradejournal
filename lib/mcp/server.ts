/**
 * The app-hosted MCP server that Claude chat connects to as a custom connector.
 *
 * Claude chat holds the Robinhood MCP and web search; this server is how it
 * reads the app's market scan and writes research back. Each request is
 * stateless: the route resolves the connector secret to a user, builds a fresh
 * server bound to that user's stores, answers, and tears down.
 *
 * Every write is validated with the Zod schemas from lib/schemas.ts — a bad
 * payload comes back as a tool error Claude can fix, never coerced.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  MarketSweepInputSchema,
  TickerReportInputSchema,
  TickerSymbolSchema,
  sweepProblems,
  tickerReportProblems,
} from "@/lib/schemas";
import { computeTechnicals } from "@/lib/technicals";
import { addDays, exchangeDate, groupBars, type IngestResult } from "@/lib/market-ingest";
import { reportFreshness } from "@/lib/research";
import type { MarketStore, ResearchStore } from "@/lib/research-store";
import { universeEntry } from "@/lib/universe";

export type McpDeps = {
  research: ResearchStore;
  market: MarketStore;
  /** Fill missing EOD sessions. Throws when no provider key is configured. */
  refreshMarket: () => Promise<IngestResult>;
  now: () => Date;
};

export const SERVER_INSTRUCTIONS = `Trade Journal research server.

Use it with the market-sweep and ticker-research skills.
- get_market_scan is the whole S&P 500 + Nasdaq-100 picture in ONE call (breadth, sector rotation, industries, index contributors, anomalies with reason codes). Never sweep the universe through Robinhood.
- get_symbol_detail gives computed technicals from stored daily bars for up to 10 symbols — prefer it over fetching historicals elsewhere.
- Conventions for everything you write: money in integer cents, percentages in percent units (1.25 = 1.25%), implied volatility as a decimal, timestamps ISO-8601 with offset, and null (not 0) for anything unknown.
- Articles: only items published within ~2 days of the analysis, at most 5, never padded with older ones. Sweep news: headlines of the day only (≤ 36h old), at most 8.
- This server cannot trade. Never place or review orders in any connected brokerage as part of research.`;

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const fail = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

/** Run a tool body, turning thrown errors into tool errors Claude can read. */
async function guarded<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function compactBars(bars: { date: string; open_cents: number; high_cents: number; low_cents: number; close_cents: number; volume: number }[]) {
  return bars.map((b) => [b.date, b.open_cents, b.high_cents, b.low_cents, b.close_cents, b.volume]);
}

export function createResearchMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "trade-journal-research", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // --- market -------------------------------------------------------------

  server.registerTool(
    "get_market_scan",
    {
      title: "Market scan digest",
      description:
        "Deterministic end-of-day scan of every S&P 500 and Nasdaq-100 stock: breadth, index proxies, sector rotation (1/5/20d returns, breadth, relative volume, rank change), top/bottom industries, top contributors to the market's move (bps), and up to 25 anomalies with reason codes (REL_VOL, RET_Z, GAP, NEW_HIGH, NEW_LOW, SECTOR_DIVERGENCE, QUIET_ACCUMULATION, STREAK). Returns are percent units, prices integer cents. Omit `date` for the latest session; the server first tops up any missing sessions.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Session date YYYY-MM-DD; omit for the latest"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ date }) =>
      guarded(async () => {
        let refresh: IngestResult | { error: string } | null = null;
        if (!date) {
          try {
            refresh = await deps.refreshMarket();
          } catch (e) {
            refresh = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        const scan = await deps.market.getScan(date);
        if (!scan) {
          return fail(
            date
              ? `No scan stored for ${date}. Recent sessions: ${(await deps.market.listScanDates(5)).join(", ") || "none"}.`
              : `No market scan yet. ${refresh && "error" in refresh ? `Refresh failed: ${refresh.error}` : "Market data has not been ingested — the backfill script or daily cron must run first."}`
          );
        }
        return text({
          ...scan.digest,
          computed_at: scan.computed_at,
          refresh:
            refresh && "error" in refresh
              ? { error: refresh.error }
              : refresh
                ? { ingested: refresh.ingested.map((d) => d.date), stopped_early: refresh.stoppedEarly }
                : null,
        });
      })
  );

  server.registerTool(
    "get_symbol_detail",
    {
      title: "Computed technicals for symbols",
      description:
        "Technicals computed from stored daily bars (SMA20/50/200, EMA21, RSI14, MACD, ATR14, 20d historical volatility, relative volume, 1/5/20/60d returns, distance from window high, drawdown, streak) plus the last 10 bars as [date, open, high, low, close, volume] in cents, and universe classification. Covers the scan universe and every research ticker (history starts the day after a ticker is added).",
      inputSchema: {
        symbols: z.array(TickerSymbolSchema).min(1).max(10),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ symbols }) =>
      guarded(async () => {
        const today = exchangeDate(deps.now());
        const bars = await deps.market.loadBars(addDays(today, -400), today, symbols);
        const grouped = groupBars(bars);
        const found: unknown[] = [];
        const notFound: string[] = [];
        for (const s of symbols) {
          const series = grouped[s];
          if (!series?.length) {
            notFound.push(s);
            continue;
          }
          const u = universeEntry(s);
          found.push({
            symbol: s,
            name: u?.name ?? null,
            sector: u?.sector ?? null,
            sub_industry: u?.sub_industry ?? null,
            indexes: u?.indexes ?? [],
            technicals: computeTechnicals(series),
            recent_bars: compactBars(series.slice(-10)),
          });
        }
        return text({
          results: found,
          not_found: notFound,
          ...(notFound.length
            ? { hint: "No stored bars. Use Robinhood get_equity_technical_indicators for these, or add them with add_research_ticker so future sessions are stored." }
            : {}),
        });
      })
  );

  server.registerTool(
    "refresh_market_data",
    {
      title: "Top up market data",
      description:
        "Fetch any missing end-of-day sessions (max 4 per call, provider free tier is 5 calls/minute) and recompute their scans. get_market_scan already does this; call it directly only to retry.",
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => guarded(async () => text(await deps.refreshMarket()))
  );

  // --- sweeps -------------------------------------------------------------

  server.registerTool(
    "list_market_sweeps",
    {
      title: "Recent market sweeps",
      description:
        "Your most recent sweeps (newest first), to tell a persisting rotation or trend from a new one.",
      inputSchema: { limit: z.number().int().min(1).max(10).default(3) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) =>
      guarded(async () => {
        const sweeps = await deps.research.listSweeps(limit);
        return text(
          sweeps.map((s) => ({
            id: s.id,
            scan_date: s.scan_date,
            as_of: s.as_of,
            headline: s.headline,
            regime: s.regime,
            summary: s.summary,
            highlights: s.highlights.map((h) => `${h.kind}: ${h.title}`),
            picks: s.picks.map((p) => ({ symbol: p.symbol, direction: p.direction, signal: p.signal })),
            trends: s.trends.map((t) => t.title),
            news: (s.news ?? []).map((n) => n.title),
          }))
        );
      })
  );

  server.registerTool(
    "post_market_sweep",
    {
      title: "Publish a market sweep",
      description:
        "Save the sweep shown on the Pulse tab: headline, regime, summary, highlights (abnormality/sector/trend/breadth/macro), up to 10 picks to dig into, trends, and up to 8 news headlines of the day (published within 36h of as_of, ordered by market impact). Set scan_date to the scan you based it on.",
      inputSchema: MarketSweepInputSchema.shape,
      annotations: { readOnlyHint: false },
    },
    async (input) =>
      guarded(async () => {
        const sweep = MarketSweepInputSchema.parse(input);
        const problems = sweepProblems(sweep);
        if (problems.length) return fail(`Sweep rejected: ${problems.join("; ")}`);
        const saved = await deps.research.postSweep(sweep);
        return text({ ...saved, view: "/pulse" });
      })
  );

  // --- research list ------------------------------------------------------

  server.registerTool(
    "list_research_tickers",
    {
      title: "Research list",
      description:
        "The user's research tickers with classification and how fresh each one's latest report is (fresh ≤ 1 day, aging ≤ 4 days, stale, none). Refresh stale or missing ones first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guarded(async () => {
        const now = deps.now().getTime();
        const list = await deps.research.listTickers();
        return text(
          list.map((t) => ({
            symbol: t.symbol,
            sector: t.sector,
            industry: t.industry,
            setup: t.setup,
            added_by: t.added_by,
            latest_report_at: t.latest_report_at,
            freshness: reportFreshness(t.latest_report_at, now),
          }))
        );
      })
  );

  server.registerTool(
    "add_research_ticker",
    {
      title: "Add to research list",
      description:
        "Add a ticker to the user's research list (no-op if present). Sector/industry default from the scan universe when known.",
      inputSchema: {
        symbol: TickerSymbolSchema,
        sector: z.string().trim().max(80).optional(),
        industry: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(500).optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ symbol, sector, industry, notes }) =>
      guarded(async () => {
        const u = universeEntry(symbol);
        const t = await deps.research.addTicker(
          {
            symbol,
            sector: sector ?? u?.sector ?? null,
            industry: industry ?? u?.sub_industry ?? null,
            notes: notes ?? null,
          },
          "claude"
        );
        return text({ symbol: t.symbol, sector: t.sector, industry: t.industry });
      })
  );

  server.registerTool(
    "remove_research_ticker",
    {
      title: "Remove from research list",
      description: "Remove a ticker from the user's research list. Only do this when the user asks.",
      inputSchema: { symbol: TickerSymbolSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ symbol }) =>
      guarded(async () => text({ symbol, removed: await deps.research.removeTicker(symbol) }))
  );

  // --- ticker reports -----------------------------------------------------

  server.registerTool(
    "get_ticker_report",
    {
      title: "Latest ticker report",
      description: "The latest saved report for a ticker, to compare against before writing a new one.",
      inputSchema: { symbol: TickerSymbolSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) =>
      guarded(async () => {
        const r = await deps.research.getLatestReport(symbol);
        return r ? text(r) : fail(`No report saved for ${symbol} yet.`);
      })
  );

  server.registerTool(
    "save_ticker_report",
    {
      title: "Save a ticker report",
      description:
        "Save the analysis shown on the Research tab: snapshot numbers, the four technical dimensions (trend/momentum/volatility/risk with ratings), a short fundamentals paragraph, and up to 5 articles from the last ~2 days. Adds the ticker to the research list if needed and updates its sector/industry/setup. Options strategy ideas are not accepted yet.",
      inputSchema: TickerReportInputSchema.shape,
      annotations: { readOnlyHint: false },
    },
    async (input) =>
      guarded(async () => {
        const report = TickerReportInputSchema.parse(input);
        const problems = tickerReportProblems(report);
        if (problems.length) return fail(`Report rejected: ${problems.join("; ")}`);
        const u = universeEntry(report.symbol);
        const saved = await deps.research.saveReport({
          ...report,
          sector: report.sector ?? u?.sector ?? null,
          industry: report.industry ?? u?.sub_industry ?? null,
        });
        return text({ ...saved, view: `/research?symbol=${encodeURIComponent(report.symbol)}` });
      })
  );

  server.registerTool(
    "list_open_positions",
    {
      title: "Open journal positions",
      description:
        "Open strategies and their open legs from the user's trade journal (strikes in cents), so sweeps and research can flag overlap with existing exposure.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guarded(async () => text(await deps.research.listOpenPositions()))
  );

  return server;
}

/**
 * Serve one MCP HTTP request. Stateless Streamable HTTP with JSON responses:
 * no sessions and no server-initiated SSE stream, which suits serverless.
 */
export async function handleMcpRequest(
  request: Request,
  opts: {
    secret: string;
    resolveUser: (secret: string) => Promise<string | null>;
    makeDeps: (userId: string) => McpDeps;
  }
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    });
  }
  const userId = await opts.resolveUser(opts.secret);
  if (!userId) {
    // 404 rather than 401: an unknown connector URL should look like nothing.
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const server = createResearchMcpServer(opts.makeDeps(userId));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
