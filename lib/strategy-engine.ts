/**
 * Options strategy engine: ties the regime read, anchor levels, the catalogue
 * and the economics gate together for the MCP tools
 * (get_strategy_context / evaluate_option_strategies / save_strategy_set).
 *
 * Pure — callers pass in stored bars and the latest ticker report.
 */
import { buildStorageOcc } from "./occ";
import { gapSize, supportResistance } from "./levels";
import { buildStructures } from "./strategy-catalog";
import {
  REJECT_REASON_TEXT,
  calendarDte,
  chainIndex,
  evaluateStructure,
  familyKey,
  rankAndDiversify,
  structureLabel,
  type ChainContract,
  type EvalContext,
  type Evaluation,
  type RejectReason,
  type Structure,
} from "./strategy-economics";
import {
  MULTI_EXPIRY,
  STRATEGY_RULES,
  selectFamilies,
  type Horizon,
  type Selection,
} from "./strategy-rules";
import { computeTechnicals, type OhlcvBar } from "./technicals";
import type { EvaluateStrategiesInput, SaveStrategySetInput } from "./schemas";
import type { StrategyIdea, StrategySetSummary, TickerReport } from "./types";

export type StrategyContext = {
  symbol: string;
  as_of: string;
  reference_price_cents: number;
  reference_source: "input" | "report" | "last_close";
  last_close_cents: number | null;
  last_bar_date: string | null;
  report: {
    as_of: string;
    price_cents: number | null;
    ratings: { trend: string; momentum: string; volatility: string; risk: string } | null;
    iv: number | null;
    iv_rank: number | null;
    next_earnings_date: string | null;
  } | null;
  hv20: number | null;
  atr_cents: number | null;
  supports_cents: number[];
  resistances_cents: number[];
  gap_cents: number | null;
  days_to_earnings: number | null;
  selections: Partial<Record<Horizon, Selection>>;
  warnings: string[];
};

export function buildStrategyContext(args: {
  symbol: string;
  asOf: string;
  horizons: readonly Horizon[];
  bars: OhlcvBar[];
  report: TickerReport | null;
  referencePriceCents?: number;
}): StrategyContext {
  const { symbol, asOf, horizons, bars, report } = args;
  const warnings: string[] = [];
  const tech = bars.length ? computeTechnicals(bars) : null;
  const lastClose = tech?.close_cents ?? null;
  const reportPrice = report?.snapshot?.price_cents ?? null;
  const ref = args.referencePriceCents ?? reportPrice ?? lastClose;
  const source = args.referencePriceCents ? "input" : reportPrice ? "report" : "last_close";
  if (ref === null) throw new Error(`No price for ${symbol}: no stored bars and no report. Pass reference_price_cents.`);

  if (!report) warnings.push("No ticker report: trend/momentum/risk unknown, regime read is neutral. Run ticker-research first for a real read.");
  else if (Date.parse(asOf) - Date.parse(report.as_of) > 4 * 86_400_000) {
    warnings.push(`Ticker report is from ${report.as_of.slice(0, 10)}: the regime read may be out of date.`);
  }
  if (bars.length < 21) warnings.push("Fewer than 21 stored sessions: levels, ATR and realized volatility may be missing.");

  const levels = supportResistance(bars, 20, ref);
  const gap = gapSize(bars);
  const t = report?.technicals ?? null;
  const ratings = t
    ? { trend: t.trend.rating, momentum: t.momentum.rating, volatility: t.volatility.rating, risk: t.risk.rating }
    : null;
  const iv = report?.snapshot?.iv ?? null;
  const ivRank = report?.snapshot?.iv_rank ?? null;
  const hv20 = tech?.hv20 ?? null;
  const earnings = report?.next_earnings_date ?? null;
  const daysToEarnings = earnings ? calendarDte(earnings, asOf) : null;
  if (hv20 === null) warnings.push("No realized volatility (hv20): expectancy falls back to implied volatility, which rarely clears the gate.");

  const selections: Partial<Record<Horizon, Selection>> = {};
  for (const h of horizons) {
    selections[h] = selectFamilies({
      trend: t?.trend.rating ?? null,
      momentum: t?.momentum.rating ?? null,
      volatility: t?.volatility.rating ?? null,
      risk: t?.risk.rating ?? null,
      iv,
      ivRank,
      hv20,
      daysToEarnings,
      horizon: h,
    });
  }

  return {
    symbol,
    as_of: asOf,
    reference_price_cents: ref,
    reference_source: source,
    last_close_cents: lastClose,
    last_bar_date: tech?.as_of ?? null,
    report: report
      ? {
          as_of: report.as_of,
          price_cents: reportPrice,
          ratings,
          iv,
          iv_rank: ivRank,
          next_earnings_date: earnings,
        }
      : null,
    hv20,
    atr_cents: tech?.atr14_cents ?? null,
    supports_cents: levels?.supports.slice(0, 4) ?? [],
    resistances_cents: levels?.resistances.slice(0, 4) ?? [],
    gap_cents: gap,
    days_to_earnings: daysToEarnings,
    selections,
    warnings,
  };
}

/** Expected one-sigma move over `days` calendar days (cents). */
export function expectedMove(ctx: StrategyContext, days: number): number | null {
  const sigma = ctx.report?.iv ?? ctx.hv20;
  if (!sigma) return null;
  return Math.round(ctx.reference_price_cents * sigma * Math.sqrt(Math.max(days, 1) / 365));
}

function minShortDistance(ctx: StrategyContext, h: Horizon): number {
  const sel = ctx.selections[h];
  if (sel?.earnings_mode !== "spans_earnings") return 0;
  return expectedMove(ctx, STRATEGY_RULES.horizons[h].maxDte) ?? 0;
}

/**
 * What Claude should fetch from the Robinhood chain for each horizon: a
 * bounded slice, so the chain calls stay cheap and the evaluation stays
 * focused on strikes the anchors allow.
 */
export function fetchPlan(ctx: StrategyContext) {
  const ref = ctx.reference_price_cents;
  const atr = ctx.atr_cents ?? Math.round(ref * 0.015);
  return Object.entries(ctx.selections).map(([h, sel]) => {
    const horizon = h as Horizon;
    const w = STRATEGY_RULES.horizons[horizon];
    const em = expectedMove(ctx, w.maxDte) ?? Math.round(ref * 0.05);
    const lo = Math.min(ctx.supports_cents[1] ?? ctx.supports_cents[0] ?? ref, ref - 2 * em) - 2 * atr;
    const hi = Math.max(ctx.resistances_cents[1] ?? ctx.resistances_cents[0] ?? ref, ref + 2 * em) + 2 * atr;
    const needsBack = sel!.families.some((f) => MULTI_EXPIRY.has(f));
    return {
      horizon,
      dte_window: [w.minDte, w.maxDte],
      expiries: `Up to 2 listed expiries with ${w.minDte}–${w.maxDte} calendar days to expiry (the nearest, plus one further out if listed).`,
      back_month: needsBack
        ? `Also 1 expiry 7–${STRATEGY_RULES.maxBackMonthGapDays} days after the front one, for calendars/diagonals (the same strikes).`
        : null,
      strike_band_cents: [Math.max(Math.round(lo), Math.round(ref * 0.7)), Math.min(Math.round(hi), Math.round(ref * 1.3))],
      expected_move_cents: em,
      min_short_distance_cents: minShortDistance(ctx, horizon),
      families: sel!.families,
    };
  });
}

function evalContext(ctx: StrategyContext, accountValueCents: number, asOf: string): EvalContext {
  return {
    spot_cents: ctx.reference_price_cents,
    as_of: asOf,
    hv20: ctx.hv20,
    iv_fallback: ctx.report?.iv ?? null,
    gap_cents: ctx.gap_cents,
    account_value_cents: accountValueCents,
  };
}

export type EvaluationRun = {
  evaluated: number;
  passed: number;
  top: Evaluation[];
  near_misses: Evaluation[];
  rejected: Partial<Record<RejectReason, number>>;
};

/** Build every catalogue structure for the requested horizons, plus Claude's custom ones, and gate them all. */
export function evaluateStrategies(
  input: Pick<EvaluateStrategiesInput, "horizons" | "chain" | "account_value_cents" | "as_of"> & {
    custom_structures?: EvaluateStrategiesInput["custom_structures"];
  },
  ctx: StrategyContext,
  extra: Structure[] = []
): EvaluationRun {
  const chain = input.chain as ChainContract[];
  const idx = chainIndex(chain);
  const expiries = [...new Set(chain.map((c) => c.expiry))];
  const structures: Structure[] = [];
  for (const h of input.horizons) {
    const sel = ctx.selections[h];
    if (!sel) continue;
    const w = STRATEGY_RULES.horizons[h];
    const fronts = expiries.filter((e) => {
      const d = calendarDte(e, input.as_of);
      return d >= w.minDte && d <= w.maxDte;
    });
    structures.push(
      ...buildStructures({
        chain,
        spot_cents: ctx.reference_price_cents,
        supports: ctx.supports_cents,
        resistances: ctx.resistances_cents,
        atr_cents: ctx.atr_cents,
        min_short_distance_cents: minShortDistance(ctx, h),
        families: sel.families,
        bias: sel.bias,
        front_expiries: fronts,
      })
    );
  }
  for (const c of input.custom_structures ?? []) structures.push({ family: "custom", name: c.name, legs: c.legs });
  structures.push(...extra);

  const ectx = evalContext(ctx, input.account_value_cents, input.as_of);
  const evals = structures.map((s) => restrictHorizon(evaluateStructure(s, idx, ectx), input.horizons));
  const rejected: Partial<Record<RejectReason, number>> = {};
  for (const e of evals) for (const f of e.failures) rejected[f] = (rejected[f] ?? 0) + 1;
  const failing = evals
    .filter((e) => !e.passed && e.score !== null && e.economics)
    .sort((a, b) => a.failures.length - b.failures.length || (b.score ?? 0) - (a.score ?? 0));
  const seen = new Set<string>();
  const nearMisses: Evaluation[] = [];
  for (const e of failing) {
    if (seen.has(familyKey(e.structure))) continue;
    seen.add(familyKey(e.structure));
    nearMisses.push(e);
    if (nearMisses.length === 3) break;
  }
  return {
    evaluated: evals.length,
    passed: evals.filter((e) => e.passed).length,
    top: rankAndDiversify(evals),
    near_misses: nearMisses,
    rejected,
  };
}

function restrictHorizon(e: Evaluation, horizons: readonly Horizon[]): Evaluation {
  if (e.horizon && !horizons.includes(e.horizon) && !e.failures.includes("outside_horizon")) {
    return { ...e, failures: [...e.failures, "outside_horizon"], passed: false };
  }
  return e;
}

/** Compact JSON for a tool result or a stored idea (without Claude's prose). */
export function summarizeEvaluation(e: Evaluation, symbol: string, opts: { payoff?: boolean } = {}) {
  return {
    family: e.structure.family,
    label: structureLabel(e.structure),
    name: e.structure.family === "custom" ? e.structure.name : null,
    horizon: e.horizon,
    front_expiry: e.front_expiry,
    dte: e.dte,
    legs: e.legs.map((l) => ({
      side: l.side,
      ratio: l.ratio,
      type: l.type,
      strike_cents: l.strike_cents,
      expiry: l.expiry,
      occ_symbol: safeOcc(symbol, l),
      bid_cents: l.bid_cents,
      ask_cents: l.ask_cents,
      fill_cents: l.fill_cents,
      iv: l.iv,
      open_interest: l.open_interest,
      spread_pct: l.spread_pct,
    })),
    economics: e.economics,
    sizing: e.sizing,
    liquidity: e.liquidity,
    flags: e.flags,
    score: e.score,
    ...(e.failures.length ? { failures: e.failures.map((f) => REJECT_REASON_TEXT[f]) } : {}),
    ...(opts.payoff ? { payoff: e.payoff } : {}),
  };
}

function safeOcc(symbol: string, l: { expiry: string; strike_cents: number; type: "call" | "put" }): string | null {
  return /^[A-Z]{1,5}$/.test(symbol) ? buildStorageOcc(symbol, l.expiry, l.strike_cents, l.type) : null;
}

/**
 * Re-price and gate the ideas Claude chose. Returns stored ideas ranked by the
 * server's score, or problems if any idea fails the gate.
 */
/** The structures behind Claude's chosen ideas. */
export function ideaStructures(input: SaveStrategySetInput): Structure[] {
  return input.ideas.map((idea) => ({
    family: idea.family,
    name: idea.family === "custom" ? (idea.name ?? "Custom") : idea.family,
    legs: idea.legs,
  }));
}

export function gateIdeas(
  input: SaveStrategySetInput,
  ctx: StrategyContext
): { ideas: StrategyIdea[]; problems: string[] } {
  const idx = chainIndex(input.chain as ChainContract[]);
  const ectx = evalContext(ctx, input.account_value_cents, input.as_of);
  const problems: string[] = [];
  const evaluated: { e: Evaluation; i: number }[] = [];
  const families = new Set<string>();
  const structures = ideaStructures(input);
  input.ideas.forEach((_idea, i) => {
    const structure = structures[i];
    const e = restrictHorizon(evaluateStructure(structure, idx, ectx), input.horizons);
    if (!e.passed) {
      problems.push(
        `ideas[${i}] (${structureLabel(structure)}) fails the gate: ${e.failures.map((f) => REJECT_REASON_TEXT[f]).join("; ")}`
      );
    }
    const k = familyKey(structure);
    if (families.has(k)) problems.push(`ideas[${i}] repeats a family — ideas must be strategy-diverse`);
    families.add(k);
    evaluated.push({ e, i });
  });
  if (problems.length) return { ideas: [], problems };
  evaluated.sort((a, b) => (b.e.score ?? 0) - (a.e.score ?? 0));
  const ideas = evaluated.map(({ e, i }, rank) => {
    const idea = input.ideas[i];
    const s = summarizeEvaluation(e, input.symbol, { payoff: true });
    return {
      ...s,
      rank: rank + 1,
      horizon: e.horizon!,
      front_expiry: e.front_expiry!,
      dte: e.dte!,
      economics: e.economics!,
      score: e.score!,
      payoff: e.payoff,
      rationale: idea.rationale,
      catalysts: idea.catalysts,
      risks: idea.risks,
      exit_plan: idea.exit_plan,
    } satisfies StrategyIdea;
  });
  return { ideas, problems };
}

export function runSummary(run: EvaluationRun): StrategySetSummary {
  return { evaluated: run.evaluated, passed: run.passed, rejected: run.rejected };
}
