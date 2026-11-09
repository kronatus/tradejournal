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
  EvaluateStrategiesInputSchema,
  MarketSweepInputSchema,
  SaveStrategySetInputSchema,
  StrategyHorizonSchema,
  TickerReportInputSchema,
  TickerSymbolSchema,
  strategyRunProblems,
  strategySetProblems,
  sweepProblems,
  tickerReportProblems,
} from "@/lib/schemas";
import {
  buildStrategyContext,
  evaluateStrategies,
  fetchPlan,
  gateIdeas,
  ideaStructures,
  runSummary,
  summarizeEvaluation,
} from "@/lib/strategy-engine";
import { REJECT_REASON_TEXT, type RejectReason } from "@/lib/strategy-economics";
import { STRATEGY_RULES } from "@/lib/strategy-rules";
import { computeTechnicals } from "@/lib/technicals";
import { addDays, exchangeDate, groupBars, type IngestResult } from "@/lib/market-ingest";
import { FRESHNESS_HOURS, reportFreshness } from "@/lib/research";
import type { MarketStore, ResearchStore } from "@/lib/research-store";
import type { StrategySet, TickerReport } from "@/lib/types";
import { universeEntry } from "@/lib/universe";

export type McpDeps = {
  research: ResearchStore;
  market: MarketStore;
  /** Fill missing EOD sessions. Throws when no provider key is configured. */
  refreshMarket: () => Promise<IngestResult>;
  now: () => Date;
};

export const SERVER_INSTRUCTIONS = `Trade Journal research server.

Use it with the market-sweep, ticker-research and options-strategist skills.
- get_market_scan is the whole S&P 500 + Nasdaq-100 picture in ONE call (breadth, sector rotation, industries, index contributors, anomalies with reason codes). Never sweep the universe through Robinhood.
- get_symbol_detail gives computed technicals from stored daily bars for up to 10 symbols — prefer it over fetching historicals elsewhere.
- Conventions for everything you write: money in integer cents, percentages in percent units (1.25 = 1.25%), implied volatility as a decimal, timestamps ISO-8601 with offset, and null (not 0) for anything unknown.
- Articles: only items published within ~2 days of the analysis, at most 5, never padded with older ones. Sweep news: headlines of the day only (≤ 36h old), at most 8.
- Options strategies need fresh research: the ticker must have a ticker report ≤ 24 h old (run ticker-research first for new names, sweep picks and stale reports). Then get_strategy_context → fetch the chain slice it asks for from Robinhood → evaluate_option_strategies → save_strategy_set. The server computes every risk number (max gain/loss, R:R, PoP, expectancy, sizing) from the quotes you pass; never write them yourself.
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

/** A stored strategy set without the bulky payoff curves and regime blob. */
function compactStrategySet(s: StrategySet) {
  return {
    id: s.id,
    as_of: s.as_of,
    horizons: s.horizons,
    reference_price_cents: s.reference_price_cents,
    reference_at: s.reference_at,
    no_setup_reason: s.no_setup_reason,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ideas: s.ideas.map(({ payoff, ...idea }) => idea),
  };
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
      description:
        "The latest saved report for a ticker, to compare against before writing a new one, plus its latest options strategy set (or null).",
      inputSchema: { symbol: TickerSymbolSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol }) =>
      guarded(async () => {
        const [r, strategies] = await Promise.all([
          deps.research.getLatestReport(symbol),
          deps.research.getLatestStrategySet(symbol),
        ]);
        if (!r) return fail(`No report saved for ${symbol} yet.`);
        return text({ ...r, strategies: strategies ? compactStrategySet(strategies) : null });
      })
  );

  server.registerTool(
    "save_ticker_report",
    {
      title: "Save a ticker report",
      description:
        "Save the analysis shown on the Research tab: snapshot numbers, the four technical dimensions (trend/momentum/volatility/risk with ratings), a short fundamentals paragraph, and up to 5 articles from the last ~2 days. Adds the ticker to the research list if needed and updates its sector/industry/setup. Options strategies are saved separately with save_strategy_set (options-strategist skill), which refreshes only that section.",
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

  // --- options strategies -------------------------------------------------

  /**
   * Strategies need research behind them: the ticker must be on the research
   * list with a ticker report no older than FRESHNESS_HOURS.fresh. New names
   * and sweep picks get there by running ticker-research first (saving a
   * report adds the ticker to the list).
   */
  async function researchGate(
    symbol: string
  ): Promise<{ problem: string; report: null } | { problem: null; report: TickerReport }> {
    const [tickers, report] = await Promise.all([deps.research.listTickers(), deps.research.getLatestReport(symbol)]);
    const listed = tickers.some((t) => t.symbol === symbol);
    if (!listed || !report) {
      return {
        problem: `No research for ${symbol} yet. Run the ticker-research skill on ${symbol} first (it saves the report and adds ${symbol} to the research list), then run the options strategist.`,
        report: null,
      };
    }
    const now = deps.now().getTime();
    if (reportFreshness(report.as_of, now) !== "fresh") {
      const hours = Math.round((now - Date.parse(report.as_of)) / 3_600_000);
      return {
        problem: `${symbol}'s research is from ${report.as_of} (${hours} h old; strategies need it ≤ ${FRESHNESS_HOURS.fresh} h). Refresh it with the ticker-research skill, then continue with the options strategist.`,
        report: null,
      };
    }
    return { problem: null, report };
  }

  async function strategyContext(
    symbol: string,
    report: TickerReport,
    asOf: string,
    horizons: ("short" | "long")[],
    ref?: number
  ) {
    const today = exchangeDate(deps.now());
    const bars = await deps.market.loadBars(addDays(today, -400), today, [symbol]);
    return buildStrategyContext({
      symbol,
      asOf,
      horizons,
      bars: groupBars(bars)[symbol] ?? [],
      report,
      referencePriceCents: ref,
    });
  }

  const rejectedText = (r: Partial<Record<RejectReason, number>>) =>
    Object.fromEntries(Object.entries(r).map(([k, n]) => [REJECT_REASON_TEXT[k as RejectReason] ?? k, n]));

  const GATE_TEXT = `Gate (all required): max loss ≤ ${STRATEGY_RULES.maxRiskToReward}× max gain; expected P&L > 0 under realized volatility (hv20) at natural bid/ask; one unit's max loss ≤ ${STRATEGY_RULES.maxAccountRiskFraction * 100}% of the account; a recent-size gap (max of the largest 20-session gap and ATR14) toward the worse side must not reach max loss.`;

  server.registerTool(
    "get_strategy_context",
    {
      title: "Options strategy context",
      description:
        "Step 1 of the options-strategist workflow. The regime read for a ticker (latest report's trend/momentum/volatility/risk ratings, IV, IV rank vs 20-day realized volatility, days to earnings), support/resistance from the last 20 sessions, the gap size a structure must survive, the eligible strategy families per horizon (short = 0–3 DTE, long = 4–21 DTE), and a fetch plan: which expiries and strike band to pull from the Robinhood chain. Requires research first: the ticker must be on the research list with a ticker report ≤ 24 h old — if not, the error says so; run the ticker-research skill on it, then call this again.",
      inputSchema: {
        symbol: TickerSymbolSchema,
        horizons: z.array(StrategyHorizonSchema).min(1).max(2).default(["short", "long"]),
        reference_price_cents: z.number().int().positive().optional().describe("Live underlying price if you have it"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ symbol, horizons, reference_price_cents }) =>
      guarded(async () => {
        const gate = await researchGate(symbol);
        if (gate.problem !== null) return fail(gate.problem);
        const ctx = await strategyContext(symbol, gate.report, deps.now().toISOString(), horizons, reference_price_cents);
        return text({
          research: {
            report_as_of: gate.report.as_of,
            age_hours: Math.round(((deps.now().getTime() - Date.parse(gate.report.as_of)) / 3_600_000) * 10) / 10,
          },
          context: ctx,
          fetch_plan: fetchPlan(ctx),
          gate: GATE_TEXT,
          limits: {
            max_chain_contracts: STRATEGY_RULES.maxChainContracts,
            max_custom_structures: STRATEGY_RULES.maxCustomStructures,
            staleness_minutes: STRATEGY_RULES.staleness,
          },
          next:
            "Read the options account value (Robinhood get_accounts), quote the underlying, fetch the chain slice (bid/ask/IV/open interest for calls and puts at every listed strike in the band), then call evaluate_option_strategies.",
        });
      })
  );

  server.registerTool(
    "evaluate_option_strategies",
    {
      title: "Evaluate options strategies",
      description:
        "Step 2. Builds every eligible structure from the catalogue (credit spreads, iron condors/butterflies incl. unbalanced wings, long and broken-wing butterflies, jade lizards, 1×2 put ratios, cash-secured puts, calendars, diagonals, double diagonals, and debit spreads when the setup demands direction) plus up to 5 custom structures you design, prices each at natural bid/ask from the chain you pass, and applies the gate. Returns up to 3 ranked, strategy-diverse candidates with full economics (max gain/loss, R:R, breakevens, PoP and expectancy under realized and implied vol, theta, gap test, sizing), the best near misses with their failure reasons, and rejection counts. Nothing is saved. Requires a ticker report ≤ 24 h old. If nothing passes, try other strikes/widths/expiries or a custom structure — or report no compliant setup.",
      inputSchema: EvaluateStrategiesInputSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) =>
      guarded(async () => {
        const run = EvaluateStrategiesInputSchema.parse(input);
        const problems = strategyRunProblems(run, deps.now());
        if (problems.length) return fail(`Evaluation rejected: ${problems.join("; ")}`);
        const gate = await researchGate(run.symbol);
        if (gate.problem !== null) return fail(gate.problem);
        const ctx = await strategyContext(run.symbol, gate.report, run.as_of, run.horizons, run.reference_price_cents);
        const result = evaluateStrategies(run, ctx);
        return text({
          symbol: run.symbol,
          reference_price_cents: ctx.reference_price_cents,
          gate: GATE_TEXT,
          regime: ctx.selections,
          warnings: ctx.warnings,
          evaluated: result.evaluated,
          passed: result.passed,
          no_compliant_setup: result.top.length === 0,
          candidates: result.top.map((e) => summarizeEvaluation(e, run.symbol)),
          near_misses: result.near_misses.map((e) => summarizeEvaluation(e, run.symbol)),
          rejected: rejectedText(result.rejected),
          units:
            "Strikes, bid/ask, net_cents: cents per share (net > 0 = credit). max_gain/max_loss/ev/theta: cents per unit (one set of legs ×100), net of fees. pop: percent.",
        });
      })
  );

  server.registerTool(
    "save_strategy_set",
    {
      title: "Save options strategy ideas",
      description:
        "Step 3. Save up to 3 ideas (distinct families) for the ticker's Options strategies section on the Research tab, replacing what is shown there; the rest of the report is untouched. Pass the same chain, reference price and account value you evaluated with, and for each idea its legs plus your rationale, catalysts, risks and exit plan. The server re-prices and re-gates every idea and stores its own numbers; an idea that fails the gate rejects the save. With no compliant setup, save ideas: [] and no_setup_reason. Requires a ticker report ≤ 24 h old.",
      inputSchema: SaveStrategySetInputSchema.shape,
      annotations: { readOnlyHint: false },
    },
    async (input) =>
      guarded(async () => {
        const set = SaveStrategySetInputSchema.parse(input);
        const problems = strategySetProblems(set, deps.now());
        if (problems.length) return fail(`Strategy set rejected: ${problems.join("; ")}`);
        const gate = await researchGate(set.symbol);
        if (gate.problem !== null) return fail(gate.problem);
        const ctx = await strategyContext(set.symbol, gate.report, set.as_of, set.horizons, set.reference_price_cents);
        const gated = gateIdeas(set, ctx);
        if (gated.problems.length) return fail(`Strategy set rejected: ${gated.problems.join("; ")}`);
        const run = evaluateStrategies(set, ctx, ideaStructures(set));
        const saved = await deps.research.saveStrategySet({
          symbol: set.symbol,
          as_of: set.as_of,
          horizons: set.horizons,
          reference_price_cents: set.reference_price_cents,
          reference_at: set.reference_at,
          account_value_cents: set.account_value_cents,
          regime: ctx as unknown as Record<string, unknown>,
          ideas: gated.ideas,
          no_setup_reason: gated.ideas.length ? null : (set.no_setup_reason ?? "No compliant setup."),
          rejected_summary: runSummary(run),
          model_notes: set.model_notes ?? null,
        });
        return text({
          ...saved,
          ideas: gated.ideas.map((i) => ({
            rank: i.rank,
            label: i.label,
            horizon: i.horizon,
            front_expiry: i.front_expiry,
            max_gain_cents: i.economics.max_gain_cents,
            max_loss_cents: i.economics.max_loss_cents,
            ev_realized_cents: i.economics.ev_realized_cents,
            qty: i.sizing?.qty ?? null,
          })),
          view: `/research?symbol=${encodeURIComponent(set.symbol)}`,
        });
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
