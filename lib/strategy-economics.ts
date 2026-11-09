/**
 * Options strategy economics: price a structure at real bid/ask, compute its
 * max gain and max loss independently, breakevens, probability of profit and
 * expectancy under realized and implied volatility, net theta, the gap test,
 * sizing against the account, and the economics gate.
 *
 * Units: strikes and prices are integer cents PER SHARE in the chain; every
 * P&L figure returned here is cents PER UNIT of the structure (one set of legs
 * at their ratios, ×100 multiplier), net of estimated fees. Volatility is a
 * decimal. Nothing here trusts a number the model wrote — inputs are quotes.
 *
 * Gate (all required):
 *   A. max loss ≤ STRATEGY_RULES.maxRiskToReward × max gain
 *   B. expected P&L > 0 under realized volatility (hv20) at natural prices
 *   C. max loss × 1 contract ≤ maxAccountRiskFraction × account
 *   D. a gap of `gapSize` toward the worse side does not reach max loss
 */
import { bsmGreeks, bsmPrice } from "./pricing";
import { exchangeDate } from "./market-ingest";
import {
  FAMILY_LABELS,
  STRATEGY_RULES,
  horizonForDte,
  type Horizon,
  type StrategyFamily,
} from "./strategy-rules";

export type OptionType = "call" | "put";
export type LegSide = "long" | "short";

export type ChainContract = {
  expiry: string;
  strike_cents: number;
  type: OptionType;
  bid_cents: number | null;
  ask_cents: number | null;
  iv: number | null;
  delta?: number | null;
  open_interest?: number | null;
  volume?: number | null;
  quoted_at: string;
};

export type StructureLeg = {
  expiry: string;
  strike_cents: number;
  type: OptionType;
  side: LegSide;
  ratio: number;
};

export type StructureFamily = StrategyFamily | "custom";

export type Structure = {
  family: StructureFamily;
  name: string;
  legs: StructureLeg[];
};

export type PricedLeg = StructureLeg & {
  bid_cents: number;
  ask_cents: number;
  /** Natural fill: ask for a long leg, bid for a short leg. */
  fill_cents: number;
  iv: number | null;
  open_interest: number | null;
  spread_pct: number | null;
};

export type EvalContext = {
  /** Reference price of the underlying (cents) the set is priced off. */
  spot_cents: number;
  /** When the reference price and quotes were taken (ISO). */
  as_of: string;
  /** Realized volatility (decimal), the basis of gate B. */
  hv20: number | null;
  /** Fallback IV (decimal) for legs without one, e.g. the report's 30-day IV. */
  iv_fallback: number | null;
  /** Gap the structure must survive (cents); null skips the test (flagged). */
  gap_cents: number | null;
  account_value_cents: number;
};

export type RejectReason =
  | "missing_contract"
  | "no_bid_on_short"
  | "no_ask_on_long"
  | "invalid_structure"
  | "expired"
  | "outside_horizon"
  | "back_month_too_far"
  | "unbounded_risk"
  | "no_profit_possible"
  | "riskless_suspect"
  | "risk_reward"
  | "negative_expectancy"
  | "account_cap"
  | "gap";

export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  missing_contract: "a leg is not in the supplied chain",
  no_bid_on_short: "a short leg has no bid",
  no_ask_on_long: "a long leg has no ask",
  invalid_structure: "invalid structure (duplicate or contradictory legs)",
  expired: "an expiry is in the past",
  outside_horizon: "front expiry outside the 0–3 / 4–21 DTE windows",
  back_month_too_far: `back leg more than ${STRATEGY_RULES.maxBackMonthGapDays} days past the front expiry`,
  unbounded_risk: "undefined (unbounded) risk",
  no_profit_possible: "no price at which it makes money",
  riskless_suspect: "no possible loss at natural prices — quotes look wrong",
  risk_reward: `max loss above ${STRATEGY_RULES.maxRiskToReward}× max gain`,
  negative_expectancy: "expected P&L ≤ 0 under realized volatility",
  account_cap: `max loss of one unit above ${STRATEGY_RULES.maxAccountRiskFraction * 100}% of the account`,
  gap: "a recent-size gap would take it to max loss",
};

export type Economics = {
  /** Per share, cents: positive = credit received, negative = debit paid. */
  net_cents: number;
  credit: boolean;
  fees_cents: number;
  /** Per unit, cents. Null = unbounded gain. */
  max_gain_cents: number | null;
  max_loss_cents: number;
  /** max loss ÷ max gain; null when gain is unbounded. */
  risk_reward: number | null;
  breakevens_cents: number[];
  pop_realized: number | null;
  pop_implied: number | null;
  ev_realized_cents: number | null;
  ev_implied_cents: number | null;
  /** Expected P&L ÷ max loss, percent. */
  ev_on_risk_pct: number | null;
  sigma_realized: number | null;
  sigma_implied: number | null;
  /** Cents per unit per calendar day at the reference price; null if a leg lacks IV. */
  theta_cents_per_day: number | null;
  /** Max gain/loss come from a model valuation of the later expiry (calendars, diagonals). */
  model_based: boolean;
  gap: { size_cents: number; worst_pnl_cents: number; survives: boolean } | null;
};

export type Sizing = { qty: number; capital_at_risk_cents: number; pct_of_account: number };

export type Evaluation = {
  structure: Structure;
  legs: PricedLeg[];
  front_expiry: string | null;
  dte: number | null;
  horizon: Horizon | null;
  economics: Economics | null;
  sizing: Sizing | null;
  liquidity: { max_spread_pct: number | null; flags: string[] };
  flags: string[];
  failures: RejectReason[];
  passed: boolean;
  /** Ranking score: expected return on risk, liquidity-penalised. */
  score: number | null;
  /** [price_cents, pnl_cents] at the front expiry, for the payoff chart. */
  payoff: [number, number][];
};

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
/** Floor on time to expiry so 0 DTE late in the day still has a distribution. */
const MIN_T_MS = 15 * 60_000;

const NY_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
const offsetCache = new Map<string, number>();

/** UTC offset of New York at `date` noon, in hours (−4 or −5). */
function nyOffsetHours(date: string): number {
  const cached = offsetCache.get(date);
  if (cached !== undefined) return cached;
  const part = NY_OFFSET.formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d+)/);
  const h = m ? Number(m[1]) : -5;
  offsetCache.set(date, h);
  return h;
}

/** 16:00 New York on `date`, as epoch ms. */
export function expiryCloseMs(date: string): number {
  return Date.parse(`${date}T16:00:00Z`) - nyOffsetHours(date) * 3_600_000;
}

/** Calendar days from the exchange date of `asOf` to `expiry`. */
export function calendarDte(expiry: string, asOf: string): number {
  const today = exchangeDate(new Date(asOf));
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

function yearsBetween(fromMs: number, toMs: number): number {
  return Math.max(toMs - fromMs, MIN_T_MS) / YEAR_MS;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export const contractKey = (c: { expiry: string; type: OptionType; strike_cents: number }) =>
  `${c.expiry}|${c.type}|${c.strike_cents}`;

const sign = (side: LegSide) => (side === "long" ? 1 : -1);

function intrinsic(S: number, K: number, type: OptionType): number {
  return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
}

function priceLegs(
  structure: Structure,
  chain: Map<string, ChainContract>
): { legs: PricedLeg[]; failures: RejectReason[] } {
  const failures = new Set<RejectReason>();
  const legs: PricedLeg[] = [];
  for (const leg of structure.legs) {
    const c = chain.get(contractKey(leg));
    if (!c) {
      failures.add("missing_contract");
      continue;
    }
    const bid = c.bid_cents;
    const ask = c.ask_cents;
    if (leg.side === "short" && !(bid !== null && bid > 0)) failures.add("no_bid_on_short");
    if (leg.side === "long" && !(ask !== null && ask > 0)) failures.add("no_ask_on_long");
    const mid = bid !== null && ask !== null && bid + ask > 0 ? (bid + ask) / 2 : null;
    legs.push({
      ...leg,
      bid_cents: bid ?? 0,
      ask_cents: ask ?? 0,
      fill_cents: leg.side === "long" ? (ask ?? 0) : (bid ?? 0),
      iv: c.iv ?? null,
      open_interest: c.open_interest ?? null,
      spread_pct: mid && ask !== null && bid !== null ? round(((ask - bid) / mid) * 100, 1) : null,
    });
  }
  return { legs, failures: [...failures] };
}

function validStructure(s: Structure): boolean {
  if (!s.legs.length || s.legs.length > 8) return false;
  const seen = new Set<string>();
  for (const l of s.legs) {
    if (!Number.isInteger(l.ratio) || l.ratio < 1 || l.ratio > 10) return false;
    if (!Number.isInteger(l.strike_cents) || l.strike_cents <= 0) return false;
    const k = contractKey(l);
    if (seen.has(k)) return false; // long and short the same contract, or a duplicate
    seen.add(k);
  }
  return true;
}

const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate one structure against a chain slice. Never throws for a bad
 * structure — it comes back with `failures` so the caller can report why.
 */
export function evaluateStructure(
  structure: Structure,
  chain: Map<string, ChainContract>,
  ctx: EvalContext
): Evaluation {
  const base: Evaluation = {
    structure,
    legs: [],
    front_expiry: null,
    dte: null,
    horizon: null,
    economics: null,
    sizing: null,
    liquidity: { max_spread_pct: null, flags: [] },
    flags: [],
    failures: [],
    passed: false,
    score: null,
    payoff: [],
  };
  if (!validStructure(structure)) return { ...base, failures: ["invalid_structure"] };

  const expiries = [...new Set(structure.legs.map((l) => l.expiry))].sort();
  const front = expiries[0];
  const dte = calendarDte(front, ctx.as_of);
  const horizon = horizonForDte(dte);
  const out: Evaluation = { ...base, front_expiry: front, dte, horizon };
  if (dte < 0) return { ...out, failures: ["expired"] };

  const { legs, failures } = priceLegs(structure, chain);
  out.legs = legs;
  if (!horizon) failures.push("outside_horizon");
  const backGap = (Date.parse(expiries[expiries.length - 1]) - Date.parse(front)) / DAY_MS;
  if (backGap > STRATEGY_RULES.maxBackMonthGapDays) failures.push("back_month_too_far");
  if (failures.includes("missing_contract") || failures.includes("no_bid_on_short") || failures.includes("no_ask_on_long")) {
    return { ...out, failures };
  }

  // Liquidity: flag, never reject — "liquid" is broad for a few contracts.
  const spreads = legs.map((l) => l.spread_pct).filter((v): v is number => v !== null);
  const maxSpread = spreads.length ? Math.max(...spreads) : null;
  const liqFlags: string[] = [];
  if (maxSpread !== null && maxSpread > STRATEGY_RULES.liquidity.wideSpreadPct) liqFlags.push("wide_market");
  if (legs.some((l) => l.open_interest !== null && l.open_interest < STRATEGY_RULES.liquidity.thinOpenInterest)) {
    liqFlags.push("thin_open_interest");
  }
  out.liquidity = { max_spread_pct: maxSpread, flags: liqFlags };

  const asOfMs = Date.parse(ctx.as_of);
  const frontMs = expiryCloseMs(front);
  const multiExpiry = expiries.length > 1;
  const r = STRATEGY_RULES.riskFreeRate;
  const legSigma = (l: PricedLeg) => l.iv ?? ctx.iv_fallback;

  // Per share, cents. cost > 0 = debit paid, < 0 = credit received.
  const cost = legs.reduce((s, l) => s + sign(l.side) * l.ratio * l.fill_cents, 0);
  const contracts = legs.reduce((s, l) => s + l.ratio, 0);
  const fees = contracts * STRATEGY_RULES.feePerContractCents;
  if (multiExpiry && legs.some((l) => l.expiry !== front && legSigma(l) === null)) {
    out.flags.push("back_leg_iv_missing");
    return { ...out, failures: [...failures, "invalid_structure"] };
  }

  // Remaining life of each leg at the front expiry (0 for front legs).
  const legT = legs.map((l) => (l.expiry === front ? 0 : yearsBetween(frontMs, expiryCloseMs(l.expiry))));
  /** Position value per share (cents) at the front expiry for underlying S. */
  const valueAt = (S: number): number =>
    legs.reduce((s, l, i) => {
      const v =
        legT[i] === 0
          ? intrinsic(S, l.strike_cents, l.type)
          : bsmPrice({ S: Math.max(S, 1), K: l.strike_cents, r, T: legT[i], sigma: legSigma(l)!, type: l.type });
      return s + sign(l.side) * l.ratio * v;
    }, 0);
  /** P&L per unit (cents, ×100 multiplier, net of fees) at the front expiry. */
  const pnlAt = (S: number) => (valueAt(S) - cost) * 100 - fees;

  // Right-tail slope (per share): deep ITM calls move 1:1 with the stock.
  const tailSlope = legs.filter((l) => l.type === "call").reduce((s, l) => s + sign(l.side) * l.ratio, 0);

  // Max gain / max loss, computed from the payoff itself, not a formula.
  const strikes = [...new Set(legs.map((l) => l.strike_cents))].sort((a, b) => a - b);
  let points: number[];
  if (!multiExpiry) {
    points = [0, ...strikes];
  } else {
    const lo = 1;
    const hi = Math.max(3 * ctx.spot_cents, 2 * strikes[strikes.length - 1]);
    const n = 600;
    const grid = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
    points = [...new Set([...grid, ...strikes])].sort((a, b) => a - b);
  }
  const pnls = points.map(pnlAt);
  const minPnl = Math.min(...pnls);
  const maxPnl = Math.max(...pnls);
  if (tailSlope < 0) failures.push("unbounded_risk");
  const unboundedGain = tailSlope > 0;
  const maxLoss = Math.round(-minPnl);
  const maxGain = unboundedGain ? null : Math.round(maxPnl);
  if (!unboundedGain && maxPnl <= 0) failures.push("no_profit_possible");
  if (maxLoss <= 0) failures.push("riskless_suspect");

  // Breakevens: sign changes along the payoff (exact for one expiry).
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = pnls[i - 1];
    const b = pnls[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      breakevens.push(Math.round(points[i - 1] + ((points[i] - points[i - 1]) * -a) / (b - a)));
    }
  }
  const lastPnl = pnls[pnls.length - 1];
  if (!multiExpiry && tailSlope !== 0 && Math.sign(lastPnl) === -Math.sign(tailSlope)) {
    breakevens.push(Math.round(points[points.length - 1] + -lastPnl / (tailSlope * 100)));
  }

  // Distribution at the front expiry: lognormal, zero drift in price.
  const tYears = yearsBetween(asOfMs, frontMs);
  const ivs = legs.filter((l) => l.expiry === front).map(legSigma).filter((v): v is number => v !== null);
  const sigmaImplied = ivs.length ? ivs.reduce((s, v) => s + v, 0) / ivs.length : ctx.iv_fallback;
  const sigmaRealized = ctx.hv20;
  const realized = sigmaRealized !== null ? expectation(pnlAt, ctx.spot_cents, sigmaRealized, tYears) : null;
  const implied = sigmaImplied !== null ? expectation(pnlAt, ctx.spot_cents, sigmaImplied, tYears) : null;
  if (!realized) out.flags.push("no_realized_vol");

  // Net theta at the reference price.
  let theta: number | null = 0;
  for (const l of legs) {
    const sigma = legSigma(l);
    if (sigma === null) {
      theta = null;
      break;
    }
    const g = bsmGreeks({
      S: ctx.spot_cents,
      K: l.strike_cents,
      r,
      T: Math.max(expiryCloseMs(l.expiry) - asOfMs, 0) / YEAR_MS,
      sigma,
      type: l.type,
    });
    theta += sign(l.side) * l.ratio * g.theta * 100;
  }

  // Gap test: both directions, the worse one decides.
  let gap: Economics["gap"] = null;
  if (ctx.gap_cents !== null && ctx.gap_cents > 0 && maxLoss > 0) {
    const worst = Math.min(pnlAt(ctx.spot_cents + ctx.gap_cents), pnlAt(Math.max(ctx.spot_cents - ctx.gap_cents, 1)));
    gap = {
      size_cents: ctx.gap_cents,
      worst_pnl_cents: Math.round(worst),
      survives: worst > -STRATEGY_RULES.gapMaxLossFraction * maxLoss,
    };
  } else {
    out.flags.push("gap_untested");
  }

  const riskReward = maxGain && maxGain > 0 ? round(maxLoss / maxGain, 2) : null;
  const economics: Economics = {
    net_cents: -cost || 0,
    credit: cost < 0,
    fees_cents: fees,
    max_gain_cents: maxGain,
    max_loss_cents: maxLoss,
    risk_reward: riskReward,
    breakevens_cents: breakevens,
    pop_realized: realized ? round(realized.pop * 100, 1) : null,
    pop_implied: implied ? round(implied.pop * 100, 1) : null,
    ev_realized_cents: realized ? Math.round(realized.ev) : null,
    ev_implied_cents: implied ? Math.round(implied.ev) : null,
    ev_on_risk_pct: realized && maxLoss > 0 ? round((realized.ev / maxLoss) * 100, 1) : null,
    sigma_realized: sigmaRealized,
    sigma_implied: sigmaImplied !== null ? round(sigmaImplied, 4) : null,
    theta_cents_per_day: theta === null ? null : Math.round(theta),
    model_based: multiExpiry,
    gap,
  };
  out.economics = economics;

  // Gate.
  if (maxLoss > 0 && maxGain !== null && maxGain > 0 && maxLoss > STRATEGY_RULES.maxRiskToReward * maxGain) {
    failures.push("risk_reward");
  }
  if (!realized || realized.ev <= 0) failures.push("negative_expectancy");
  const cap = STRATEGY_RULES.maxAccountRiskFraction * ctx.account_value_cents;
  const qty = maxLoss > 0 ? Math.floor(cap / maxLoss) : 0;
  if (maxLoss > 0 && qty < 1) failures.push("account_cap");
  if (gap && !gap.survives) failures.push("gap");
  if (qty >= 1) {
    out.sizing = {
      qty,
      capital_at_risk_cents: qty * maxLoss,
      pct_of_account: round(((qty * maxLoss) / ctx.account_value_cents) * 100, 1),
    };
  }

  out.payoff = payoffCurve(pnlAt, strikes, ctx);
  out.failures = [...new Set(failures)];
  out.passed = out.failures.length === 0;
  if (realized && maxLoss > 0) {
    const penalty = Math.min(STRATEGY_RULES.liquidity.maxPenalty, (maxSpread ?? 0) / 200);
    out.score = round((realized.ev / maxLoss) * (1 - penalty), 5);
  }
  return out;
}

/**
 * Probability of profit and expected P&L of `pnl(S)` when S at expiry is
 * lognormal around `spot` with volatility `sigma` over `t` years (zero drift
 * in price). Trapezoid rule over ±6σ.
 */
export function expectation(
  pnl: (S: number) => number,
  spot: number,
  sigma: number,
  t: number,
  steps = 1200
): { ev: number; pop: number } {
  const sd = sigma * Math.sqrt(t);
  const mu = -0.5 * sd * sd;
  let ev = 0;
  let pop = 0;
  let wsum = 0;
  const dz = 12 / steps;
  for (let i = 0; i <= steps; i++) {
    const z = -6 + i * dz;
    const w = Math.exp(-0.5 * z * z) * (i === 0 || i === steps ? 0.5 : 1);
    const p = pnl(spot * Math.exp(mu + sd * z));
    ev += w * p;
    if (p > 0) pop += w;
    wsum += w;
  }
  return { ev: ev / wsum, pop: pop / wsum };
}

function payoffCurve(pnlAt: (S: number) => number, strikes: number[], ctx: EvalContext): [number, number][] {
  const g = ctx.gap_cents ?? 0;
  const lo = Math.max(1, Math.min(strikes[0], ctx.spot_cents - 2 * g) * 0.97);
  const hi = Math.max(strikes[strikes.length - 1], ctx.spot_cents + 2 * g) * 1.03;
  const n = 48;
  const pts = new Set<number>(strikes);
  for (let i = 0; i <= n; i++) pts.add(Math.round(lo + ((hi - lo) * i) / n));
  return [...pts].sort((a, b) => a - b).map((S) => [S, Math.round(pnlAt(S))]);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Diversity key: one idea per family; each named custom structure is its own family. */
export const familyKey = (s: Structure) => (s.family === "custom" ? `custom:${s.name.toLowerCase()}` : s.family);

/**
 * Keep the best passing structure per family, ranked by expected return on
 * risk; theta-positive wins a tie. At most `limit` ideas.
 */
export function rankAndDiversify(evals: Evaluation[], limit: number = STRATEGY_RULES.maxIdeas): Evaluation[] {
  const passing = evals
    .filter((e) => e.passed && e.score !== null)
    .sort((a, b) => {
      const d = (b.score ?? 0) - (a.score ?? 0);
      if (Math.abs(d) > 1e-9) return d;
      return (b.economics?.theta_cents_per_day ?? 0) - (a.economics?.theta_cents_per_day ?? 0);
    });
  const seen = new Set<string>();
  const out: Evaluation[] = [];
  for (const e of passing) {
    const k = familyKey(e.structure);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length === limit) break;
  }
  return out;
}

export function structureLabel(s: Structure): string {
  return s.family === "custom" ? s.name : FAMILY_LABELS[s.family];
}

export function chainIndex(chain: ChainContract[]): Map<string, ChainContract> {
  return new Map(chain.map((c) => [contractKey(c), c]));
}
