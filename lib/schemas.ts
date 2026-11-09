import { z } from "zod";
import { HORIZONS, STRATEGY_FAMILIES, STRATEGY_RULES } from "./strategy-rules";

// OCC symbol: O:AAPL250117C00150000
export const OccSymbolSchema = z
  .string()
  .regex(/^O:[A-Z]{1,5}\d{6}[CP]\d{8}$/, "Invalid OCC format");

export const LegInputSchema = z.object({
  occ_symbol: OccSymbolSchema,
  side: z.enum(["buy", "sell"]),
  action: z.enum(["open", "close"]),
  quantity: z.number().int().positive(),
  entry_price_cents: z.number().int().nonnegative(),
  exit_price_cents: z.number().int().nullable().optional(),
  stop_loss_cents: z.number().int().nullable().optional(),
  target_cents: z.number().int().nullable().optional(),
});

export const StrategyInputSchema = z.object({
  underlying: z.string().min(1).max(5),
  strategy_kind: z.enum([
    "long_call",
    "long_put",
    "short_call",
    "short_put",
    "vertical",
    "iron_condor",
    "calendar",
    "straddle",
    "strangle",
    "custom",
  ]),
  conviction_rating: z.number().int().min(1).max(5),
  notes: z.string().default(""),
  opened_at: z.string().datetime(),
  legs: z.array(LegInputSchema).min(1),
});

export const QuoteSchema = z.object({
  // A deep-OTM contract can legitimately mark at zero. Treat that as data,
  // not as a missing quote -- dropping it silently understates the position.
  price: z.number().nonnegative(),
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
  iv: z.number().nonnegative(),
  asOf: z.string().datetime(),
  // True when the provider returned a price but no Greeks. Callers must not
  // fold these into net Greeks -- zero is a claim, absence is not.
  greeksMissing: z.boolean().default(false),
  // Spot price of the underlying, when the provider supplies it alongside the
  // option quote. Free here -- it rides along in the same response.
  underlyingPrice: z.number().positive().nullable().default(null),
});

export const CanonicalFillSchema = z.object({
  external_fill_id: z.string().min(1),
  external_group_ref: z.string().nullable(),
  filled_at: z.coerce.date(),
  underlying: z.string().min(1).max(5).toUpperCase(),
  option_type: z.enum(["call", "put"]),
  strike_cents: z.number().int().positive(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  side: z.enum(["long", "short"]),
  action: z.enum(["open", "close"]),
  qty: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  fees_cents: z.number().int().nonnegative(),
});

export const ColumnMappingSchema = z.record(
  z.enum([
    "filled_at",
    "underlying",
    "option_type",
    "strike_cents",
    "expiry",
    "side",
    "action",
    "qty",
    "price_cents",
    "fees_cents",
    "external_fill_id",
    "external_group_ref",
  ]),
  z.string()
);

export const StrategyPatchSchema = z.object({
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  thesis: z.string().nullable().optional(),
  post_mortem: z.string().nullable().optional(),
  planned_stop_cents: z.number().int().nonnegative().nullable().optional(),
  planned_target_cents: z.number().int().nonnegative().nullable().optional(),
  collateral_cents: z.number().int().nonnegative().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
});

export const LegClosePatchSchema = z.object({
  exit_price_cents: z.number().int().nonnegative(),
  exit_at: z.string().datetime(),
  exit_delta: z.number().nullable().optional(),
  exit_gamma: z.number().nullable().optional(),
  exit_theta: z.number().nullable().optional(),
  exit_vega: z.number().nullable().optional(),
  exit_iv: z.number().nullable().optional(),
});

export const LegCreateSchema = z.object({
  occ_symbol: OccSymbolSchema,
  option_type: z.enum(["call", "put"]),
  side: z.enum(["long", "short"]),
  qty: z.number().int().positive(),
  entry_price_cents: z.number().int().nonnegative(),
  entry_at: z.string().datetime(),
  fees_cents: z.number().int().nonnegative().default(0),
  entry_delta: z.number().nullable().optional(),
  entry_gamma: z.number().nullable().optional(),
  entry_theta: z.number().nullable().optional(),
  entry_vega: z.number().nullable().optional(),
  entry_iv: z.number().nullable().optional(),
});

export type LegInput = z.infer<typeof LegInputSchema>;
export type StrategyInput = z.infer<typeof StrategyInputSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type CanonicalFill = z.infer<typeof CanonicalFillSchema>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type StrategyPatch = z.infer<typeof StrategyPatchSchema>;
export type LegClosePatch = z.infer<typeof LegClosePatchSchema>;
export type LegCreate = z.infer<typeof LegCreateSchema>;

// --- Marketdata.app -------------------------------------------------------
//
// Marketdata returns COLUMN-oriented JSON: every field is an array, and index i
// across all arrays describes one contract. A single-contract request therefore
// still returns arrays of length 1.
//
// The `s` status field discriminates the three outcomes. `no_data` is the one
// that matters most here: an unknown or malformed option symbol comes back as
// no_data rather than an error, so a bad symbol is only ever visible as an
// absent quote. That is why lib/occ.ts throws on malformed input instead of
// passing it through, and why the client below reports an explicit per-leg
// error rather than dropping the contract.

const NullableNumbers = z.array(z.number().nullable());

export const MarketdataOkSchema = z.object({
  s: z.literal("ok"),
  optionSymbol: z.array(z.string()).min(1),
  /** Unix seconds. Preserved rather than replaced: the free feed is delayed
   *  ~24h, so the real timestamp is what tells the UI how stale a mark is. */
  updated: z.array(z.number()).optional(),
  bid: NullableNumbers.optional(),
  ask: NullableNumbers.optional(),
  mid: NullableNumbers.optional(),
  last: NullableNumbers.optional(),
  iv: NullableNumbers.optional(),
  delta: NullableNumbers.optional(),
  gamma: NullableNumbers.optional(),
  theta: NullableNumbers.optional(),
  vega: NullableNumbers.optional(),
  rho: NullableNumbers.optional(),
  underlyingPrice: NullableNumbers.optional(),
});

export const MarketdataNoDataSchema = z.object({
  s: z.literal("no_data"),
});

export const MarketdataErrorSchema = z.object({
  s: z.literal("error"),
  errmsg: z.string().optional(),
});

export const MarketdataResponseSchema = z.discriminatedUnion("s", [
  MarketdataOkSchema,
  MarketdataNoDataSchema,
  MarketdataErrorSchema,
]);

export type MarketdataOk = z.infer<typeof MarketdataOkSchema>;
export type MarketdataResponse = z.infer<typeof MarketdataResponseSchema>;

/** Stock quote (used for the sandbox spot price). Also column-oriented. */
export const MarketdataStockOkSchema = z.object({
  s: z.literal("ok"),
  symbol: z.array(z.string()).min(1),
  last: NullableNumbers.optional(),
  mid: NullableNumbers.optional(),
  bid: NullableNumbers.optional(),
  ask: NullableNumbers.optional(),
  updated: z.array(z.number()).optional(),
});

export const MarketdataStockResponseSchema = z.discriminatedUnion("s", [
  MarketdataStockOkSchema,
  MarketdataNoDataSchema,
  MarketdataErrorSchema,
]);

export const ForgotPasswordInputSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

export const ResetPasswordInputSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

// --- Research & Market Pulse ----------------------------------------------
//
// Payloads written by Claude chat through the app-hosted MCP server
// (app/api/mcp/[token]). They are validated here rather than trusted: a bad
// field is rejected with a message Claude can act on, never coerced. Money is
// integer cents (matching the DB convention), percentages are plain numbers in
// percent units (1.25 = 1.25%), and absent data is null — zero is a claim.

const Cents = z.number().int();
const NullableCents = Cents.nullable();
const NullableNum = z.number().finite().nullable();
const IsoDateTime = z.string().datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Equity/ETF ticker. Normalised to upper case; allows class shares (BRK.B). */
export const TickerSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, "Invalid ticker symbol");

export const TickerSnapshotSchema = z.object({
  price_cents: NullableCents,
  /** When price_cents was marked (RH venue time), not when it was fetched. */
  price_as_of: IsoDateTime.nullable(),
  session: z.enum(["regular", "extended", "closed"]).nullable(),
  prev_close_cents: NullableCents,
  change_pct: NullableNum,
  day_open_cents: NullableCents,
  day_high_cents: NullableCents,
  day_low_cents: NullableCents,
  volume: z.number().int().nonnegative().nullable(),
  avg_volume_30d: z.number().int().nonnegative().nullable(),
  week52_high_cents: NullableCents,
  week52_low_cents: NullableCents,
  market_cap_cents: NullableCents,
  pe_ratio: NullableNum,
  pb_ratio: NullableNum,
  dividend_yield_pct: NullableNum,
  beta: NullableNum,
  /** Implied volatility as a decimal (0.32 = 32%), e.g. ~30 DTE ATM. */
  iv: NullableNum,
  iv_rank: z.number().min(0).max(100).nullable(),
  analyst: z
    .object({
      buy: z.number().int().nonnegative(),
      hold: z.number().int().nonnegative(),
      sell: z.number().int().nonnegative(),
      target_mean_cents: NullableCents,
      target_high_cents: NullableCents,
      target_low_cents: NullableCents,
    })
    .nullable(),
});

const MetricMap = z.record(z.string().max(40), NullableNum).refine(
  (m) => Object.keys(m).length <= 16,
  "At most 16 metrics per dimension"
);

export const TREND_RATINGS = ["strong_up", "up", "sideways", "down", "strong_down"] as const;
export const MOMENTUM_RATINGS = ["strong", "positive", "neutral", "negative", "weak"] as const;
export const VOLATILITY_RATINGS = ["low", "normal", "elevated", "high"] as const;
export const RISK_RATINGS = ["low", "moderate", "high", "very_high"] as const;

const dimension = <T extends readonly [string, ...string[]]>(ratings: T) =>
  z.object({
    rating: z.enum(ratings),
    summary: z.string().trim().min(1).max(400),
    metrics: MetricMap.default({}),
  });

export const TechnicalsSchema = z.object({
  trend: dimension(TREND_RATINGS),
  momentum: dimension(MOMENTUM_RATINGS),
  volatility: dimension(VOLATILITY_RATINGS),
  risk: dimension(RISK_RATINGS),
});

export const ArticleSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
  source: z.string().trim().min(1).max(100),
  published_at: IsoDateTime,
  summary: z.string().trim().max(500).default(""),
});

export const TickerReportInputSchema = z.object({
  symbol: TickerSymbolSchema,
  as_of: IsoDateTime,
  sector: z.string().trim().max(80).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  setup: z.string().trim().max(80).nullable().optional(),
  snapshot: TickerSnapshotSchema,
  technicals: TechnicalsSchema,
  fundamentals: z.string().trim().min(1).max(1200),
  articles: z.array(ArticleSchema).max(5).default([]),
  next_earnings_date: IsoDate.nullable().optional(),
  model_notes: z.string().trim().max(1000).nullable().optional(),
});

/**
 * Cross-field checks kept out of the object schema so the MCP layer can still
 * publish it as a plain JSON schema. Returns human-readable problems.
 */
export function tickerReportProblems(r: TickerReportInput): string[] {
  const problems: string[] = [];
  const asOf = Date.parse(r.as_of);
  const slackMs = 6 * 60 * 60 * 1000;
  r.articles.forEach((a, i) => {
    if (Date.parse(a.published_at) > asOf + slackMs) {
      problems.push(`articles[${i}].published_at is after as_of`);
    }
  });
  const urls = new Set<string>();
  r.articles.forEach((a, i) => {
    if (urls.has(a.url)) problems.push(`articles[${i}] duplicates another article`);
    urls.add(a.url);
  });
  return problems;
}

export const SWEEP_REGIMES = ["risk_on", "risk_off", "neutral", "rotation", "volatile"] as const;
export const HIGHLIGHT_KINDS = ["abnormality", "sector", "trend", "breadth", "macro"] as const;

export const SweepHighlightSchema = z.object({
  kind: z.enum(HIGHLIGHT_KINDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(600),
  symbols: z.array(TickerSymbolSchema).max(10).default([]),
});

export const SweepPickSchema = z.object({
  symbol: TickerSymbolSchema,
  direction: z.enum(["bullish", "bearish", "neutral", "watch"]),
  horizon: z.enum(["days", "weeks", "months"]),
  signal: z.string().trim().min(1).max(120),
  thesis: z.string().trim().min(1).max(400),
  sector: z.string().trim().max(80).nullable().optional(),
});

export const SweepTrendSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(600),
  sectors: z.array(z.string().trim().max(80)).max(11).default([]),
});

export const NEWS_IMPACTS = ["market", "sector", "stock"] as const;

/** A market headline of the day, shown on Pulse. */
export const SweepNewsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: ArticleSchema.shape.url,
  source: z.string().trim().min(1).max(100),
  published_at: IsoDateTime,
  summary: z.string().trim().max(300).default(""),
  impact: z.enum(NEWS_IMPACTS),
  symbols: z.array(TickerSymbolSchema).max(6).default([]),
  sectors: z.array(z.string().trim().max(80)).max(3).default([]),
});

export const MarketSweepInputSchema = z.object({
  scan_date: IsoDate.nullable().optional(),
  as_of: IsoDateTime,
  headline: z.string().trim().min(1).max(200),
  regime: z.enum(SWEEP_REGIMES),
  summary: z.string().trim().min(1).max(2000),
  highlights: z.array(SweepHighlightSchema).max(12).default([]),
  picks: z.array(SweepPickSchema).max(10).default([]),
  trends: z.array(SweepTrendSchema).max(8).default([]),
  news: z.array(SweepNewsSchema).max(8).default([]),
});

/** "Of the day": headlines older than this, relative to as_of, are rejected. */
export const SWEEP_NEWS_MAX_AGE_HOURS = 36;

/** Cross-field checks for a sweep (kept out of the schema, like reports). */
export function sweepProblems(s: MarketSweepInput): string[] {
  const problems: string[] = [];
  const asOf = Date.parse(s.as_of);
  const slackMs = 6 * 60 * 60 * 1000;
  const urls = new Set<string>();
  s.news.forEach((n, i) => {
    const t = Date.parse(n.published_at);
    if (t > asOf + slackMs) problems.push(`news[${i}].published_at is after as_of`);
    if (t < asOf - SWEEP_NEWS_MAX_AGE_HOURS * 3_600_000) {
      problems.push(`news[${i}] is older than ${SWEEP_NEWS_MAX_AGE_HOURS}h — only news of the day belongs here`);
    }
    if (urls.has(n.url)) problems.push(`news[${i}] duplicates another headline`);
    urls.add(n.url);
  });
  return problems;
}

// --- Options strategies (Phase 11) ----------------------------------------
//
// Claude supplies quotes (a bounded chain slice from Robinhood) and, for each
// idea, legs plus prose. Every risk number is computed server-side by
// lib/strategy-economics.ts — the model never writes max loss, PoP or EV.

const OptionTypeSchema = z.enum(["call", "put"]);

export const ChainContractSchema = z.object({
  expiry: IsoDate,
  strike_cents: Cents.positive(),
  type: OptionTypeSchema,
  bid_cents: Cents.nonnegative().nullable(),
  ask_cents: Cents.nonnegative().nullable(),
  /** Implied volatility as a decimal (0.32 = 32%). */
  iv: z.number().min(0).max(10).nullable(),
  delta: NullableNum.optional(),
  open_interest: z.number().int().nonnegative().nullable().optional(),
  volume: z.number().int().nonnegative().nullable().optional(),
  /** When this contract was quoted (venue time). */
  quoted_at: IsoDateTime,
});

export const StructureLegSchema = z.object({
  expiry: IsoDate,
  strike_cents: Cents.positive(),
  type: OptionTypeSchema,
  side: z.enum(["long", "short"]),
  /** Contracts of this leg per unit of the structure (2 for a butterfly body). */
  ratio: z.number().int().min(1).max(10).default(1),
});

export const CustomStructureSchema = z.object({
  name: z.string().trim().min(1).max(60),
  legs: z.array(StructureLegSchema).min(1).max(8),
});

export const StrategyHorizonSchema = z.enum(HORIZONS);

const strategyRun = {
  symbol: TickerSymbolSchema,
  /** When the analysis was done. */
  as_of: IsoDateTime,
  horizons: z.array(StrategyHorizonSchema).min(1).max(2),
  /** Underlying price the set is priced off (RH quote), and when it was marked. */
  reference_price_cents: Cents.positive(),
  reference_at: IsoDateTime,
  /** Options account value from Robinhood, for the max-loss-per-position cap. */
  account_value_cents: Cents.positive(),
  chain: z.array(ChainContractSchema).min(1).max(STRATEGY_RULES.maxChainContracts),
};

export const EvaluateStrategiesInputSchema = z.object({
  ...strategyRun,
  custom_structures: z.array(CustomStructureSchema).max(STRATEGY_RULES.maxCustomStructures).default([]),
});

export const StrategyIdeaInputSchema = z.object({
  family: z.enum([...STRATEGY_FAMILIES, "custom"]),
  /** Required for custom structures; ignored otherwise. */
  name: z.string().trim().min(1).max(60).optional(),
  legs: z.array(StructureLegSchema).min(1).max(8),
  rationale: z.string().trim().min(1).max(500),
  catalysts: z.array(z.string().trim().min(1).max(160)).max(4).default([]),
  risks: z.array(z.string().trim().min(1).max(160)).max(4).default([]),
  exit_plan: z.string().trim().max(300).default(""),
});

export const SaveStrategySetInputSchema = z.object({
  ...strategyRun,
  ideas: z.array(StrategyIdeaInputSchema).max(STRATEGY_RULES.maxIdeas).default([]),
  no_setup_reason: z.string().trim().max(400).nullable().optional(),
  model_notes: z.string().trim().max(1000).nullable().optional(),
});

/** Minutes after which quotes for the shortest requested horizon are stale. */
export function stalenessMinutes(horizons: readonly ("short" | "long")[]): number {
  return horizons.includes("short") ? STRATEGY_RULES.staleness.shortMinutes : STRATEGY_RULES.staleness.longMinutes;
}

/** Cross-field checks shared by evaluate and save. `now` is the server clock. */
export function strategyRunProblems(r: EvaluateStrategiesInput | SaveStrategySetInput, now: Date): string[] {
  const problems: string[] = [];
  const asOf = Date.parse(r.as_of);
  const slackMs = 10 * 60_000;
  const staleMs = stalenessMinutes(r.horizons) * 60_000;
  if (asOf > now.getTime() + slackMs) problems.push("as_of is in the future");
  if (now.getTime() - asOf > staleMs) problems.push(`as_of is older than ${stalenessMinutes(r.horizons)} minutes — re-quote before saving`);
  const ref = Date.parse(r.reference_at);
  if (ref > asOf + slackMs) problems.push("reference_at is after as_of");
  if (asOf - ref > staleMs) problems.push("reference price is stale — re-quote the underlying");
  const keys = new Set<string>();
  let stale = 0;
  r.chain.forEach((c, i) => {
    const k = `${c.expiry}|${c.type}|${c.strike_cents}`;
    if (keys.has(k)) problems.push(`chain[${i}] duplicates another contract`);
    keys.add(k);
    const q = Date.parse(c.quoted_at);
    if (q > asOf + slackMs) problems.push(`chain[${i}].quoted_at is after as_of`);
    if (asOf - q > staleMs) stale++;
  });
  if (stale) problems.push(`${stale} chain quote(s) are stale — re-quote them`);
  return problems;
}

export function strategySetProblems(s: SaveStrategySetInput, now: Date): string[] {
  const problems = strategyRunProblems(s, now);
  if (!s.ideas.length && !s.no_setup_reason) {
    problems.push("no ideas: set no_setup_reason (\"no compliant setup\" and why)");
  }
  const keys = new Set(s.chain.map((c) => `${c.expiry}|${c.type}|${c.strike_cents}`));
  const sigs = new Set<string>();
  s.ideas.forEach((idea, i) => {
    if (idea.family === "custom" && !idea.name) problems.push(`ideas[${i}]: custom structures need a name`);
    idea.legs.forEach((l, j) => {
      if (!keys.has(`${l.expiry}|${l.type}|${l.strike_cents}`)) {
        problems.push(`ideas[${i}].legs[${j}] is not in the supplied chain`);
      }
    });
    const sig = idea.legs
      .map((l) => `${l.side}${l.ratio}${l.type}${l.strike_cents}${l.expiry}`)
      .sort()
      .join(",");
    if (sigs.has(sig)) problems.push(`ideas[${i}] duplicates another idea`);
    sigs.add(sig);
  });
  return problems;
}

export type ChainContractInput = z.infer<typeof ChainContractSchema>;
export type StructureLegInput = z.infer<typeof StructureLegSchema>;
export type EvaluateStrategiesInput = z.infer<typeof EvaluateStrategiesInputSchema>;
export type StrategyIdeaInput = z.infer<typeof StrategyIdeaInputSchema>;
export type SaveStrategySetInput = z.infer<typeof SaveStrategySetInputSchema>;

export type TickerSnapshot = z.infer<typeof TickerSnapshotSchema>;
export type Technicals = z.infer<typeof TechnicalsSchema>;
export type Article = z.infer<typeof ArticleSchema>;
export type TickerReportInput = z.infer<typeof TickerReportInputSchema>;
export type SweepHighlight = z.infer<typeof SweepHighlightSchema>;
export type SweepPick = z.infer<typeof SweepPickSchema>;
export type SweepTrend = z.infer<typeof SweepTrendSchema>;
export type SweepNews = z.infer<typeof SweepNewsSchema>;
export type MarketSweepInput = z.infer<typeof MarketSweepInputSchema>;

// --- Massive (ex-Polygon) grouped daily bars -------------------------------
//
// GET /v2/aggs/grouped/locale/us/market/stocks/{date} returns one row per US
// ticker for that session. A weekend, holiday, or not-yet-published day comes
// back OK with resultsCount 0 and no `results`. Anything else unrecognised
// throws rather than being coerced.

export const MassiveGroupedBarSchema = z.object({
  T: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().nonnegative(),
  vw: z.number().optional(),
  t: z.number(),
  n: z.number().optional(),
});

export const MassiveGroupedDailySchema = z.object({
  status: z.enum(["OK", "DELAYED"]),
  adjusted: z.boolean().optional(),
  queryCount: z.number().optional(),
  resultsCount: z.number(),
  results: z.array(MassiveGroupedBarSchema).optional(),
});

export const MassiveErrorSchema = z.object({
  status: z.string(),
  error: z.string().optional(),
  message: z.string().optional(),
  request_id: z.string().optional(),
});

export type MassiveGroupedBar = z.infer<typeof MassiveGroupedBarSchema>;
