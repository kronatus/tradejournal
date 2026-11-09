/**
 * Options strategy framework: thresholds and the regime → structure selector.
 *
 * Regime first, structure second. The trend/momentum/volatility/risk read
 * (from the latest ticker report) plus IV versus realized volatility and the
 * earnings calendar decide which strategy families are eligible; the catalog
 * (lib/strategy-catalog.ts) then builds concrete structures for those
 * families, and lib/strategy-economics.ts prices and gates them.
 *
 * Every threshold lives in STRATEGY_RULES so the gate, the UI and the skill
 * text can quote the same numbers.
 */
import type { MOMENTUM_RATINGS, RISK_RATINGS, TREND_RATINGS, VOLATILITY_RATINGS } from "./schemas";

export const STRATEGY_RULES = {
  /** Gate A: max loss may be at most this multiple of max gain. */
  maxRiskToReward: 3.25,
  /** Gate C: a position's max loss may be at most this share of the account. */
  maxAccountRiskFraction: 0.5,
  /** Gap test: a gap toward the worse side must leave the position better
   *  than this fraction of max loss (i.e. not blown out). */
  gapMaxLossFraction: 0.95,
  /** Calendar days to the front expiry, inclusive. */
  horizons: {
    short: { minDte: 0, maxDte: 3 },
    long: { minDte: 4, maxDte: 21 },
  },
  /** Back legs of calendars/diagonals may sit at most this many days past the front expiry. */
  maxBackMonthGapDays: 35,
  ivRich: { ivToHv: 1.15, ivRank: 50 },
  ivCheap: { ivToHv: 0.9, ivRank: 25 },
  /** Bias score (trend + momentum) at or beyond which a direction is taken. */
  biasThreshold: 1,
  /** |bias| at or beyond which a debit structure is justified even when IV is fair. */
  strongBias: 2,
  /** Short strikes may sit this many ATRs on the wrong side of an anchor level. */
  anchorToleranceAtr: 0.25,
  liquidity: {
    /** Leg bid/ask spread above this % of mid is flagged "wide". */
    wideSpreadPct: 25,
    /** Open interest below this is flagged "thin". */
    thinOpenInterest: 10,
    /** Ranking penalty cap for wide markets. */
    maxPenalty: 0.3,
  },
  staleness: {
    /** Quotes older than this (relative to as_of) make a set stale. */
    shortMinutes: 30,
    longMinutes: 24 * 60,
    /** Drift of the underlying beyond this many ATRs from the reference price makes a set stale. */
    driftAtr: 0.5,
  },
  /** Estimated regulatory + exchange fees per contract, round trip (cents). */
  feePerContractCents: 6,
  maxIdeas: 3,
  maxCandidatesEvaluated: 4000,
  maxChainContracts: 160,
  maxCustomStructures: 5,
  riskFreeRate: 0.04,
} as const;

export type Horizon = keyof typeof STRATEGY_RULES.horizons;
export const HORIZONS = ["short", "long"] as const satisfies readonly Horizon[];

export const STRATEGY_FAMILIES = [
  "put_credit_spread",
  "call_credit_spread",
  "iron_condor",
  "iron_butterfly",
  "long_butterfly",
  "put_broken_wing_butterfly",
  "call_broken_wing_butterfly",
  "jade_lizard",
  "put_ratio_spread",
  "cash_secured_put",
  "calendar",
  "diagonal",
  "double_diagonal",
  "call_debit_spread",
  "put_debit_spread",
] as const;
export type StrategyFamily = (typeof STRATEGY_FAMILIES)[number];

export const FAMILY_LABELS: Record<StrategyFamily | "custom", string> = {
  put_credit_spread: "Put credit spread",
  call_credit_spread: "Call credit spread",
  iron_condor: "Iron condor",
  iron_butterfly: "Iron butterfly",
  long_butterfly: "Long butterfly",
  put_broken_wing_butterfly: "Put broken-wing butterfly",
  call_broken_wing_butterfly: "Call broken-wing butterfly",
  jade_lizard: "Jade lizard",
  put_ratio_spread: "Put 1×2 ratio spread",
  cash_secured_put: "Cash-secured put",
  calendar: "Calendar",
  diagonal: "Diagonal",
  double_diagonal: "Double diagonal",
  call_debit_spread: "Call debit spread",
  put_debit_spread: "Put debit spread",
  custom: "Custom structure",
};

/** Families whose loss is not capped by strike width alone (a naked short put side). */
const NOT_WIDTH_DEFINED: ReadonlySet<StrategyFamily> = new Set([
  "cash_secured_put",
  "put_ratio_spread",
  "jade_lizard",
]);
/** Families bought for direction: premium buyers, theta-negative. */
const DEBIT_DIRECTIONAL: ReadonlySet<StrategyFamily> = new Set(["call_debit_spread", "put_debit_spread"]);
/** Families that need a second expiry. */
export const MULTI_EXPIRY: ReadonlySet<StrategyFamily> = new Set(["calendar", "diagonal", "double_diagonal"]);

export type Bias = "bullish" | "bearish" | "neutral";
export type IvRegime = "rich" | "fair" | "cheap" | "unknown";
export type EarningsMode = "none" | "spans_earnings";

export type RegimeInput = {
  trend: (typeof TREND_RATINGS)[number] | null;
  momentum: (typeof MOMENTUM_RATINGS)[number] | null;
  volatility: (typeof VOLATILITY_RATINGS)[number] | null;
  risk: (typeof RISK_RATINGS)[number] | null;
  /** Decimal (0.32 = 32%). */
  iv: number | null;
  ivRank: number | null;
  /** Decimal, annualised 20-session realized volatility. */
  hv20: number | null;
  /** Calendar days from as_of to the next earnings date; null if unknown. */
  daysToEarnings: number | null;
  horizon: Horizon;
};

export type Selection = {
  horizon: Horizon;
  bias: Bias;
  bias_score: number;
  iv_regime: IvRegime;
  iv_to_hv: number | null;
  earnings_mode: EarningsMode;
  /** Eligible families, in priority order. */
  families: StrategyFamily[];
  notes: string[];
};

const TREND_SCORE = { strong_up: 2, up: 1, sideways: 0, down: -1, strong_down: -2 } as const;
const MOMENTUM_SCORE = { strong: 1, positive: 0.5, neutral: 0, negative: -0.5, weak: -1 } as const;

export function ivRegime(iv: number | null, ivRank: number | null, hv20: number | null): {
  regime: IvRegime;
  ivToHv: number | null;
} {
  const ivToHv = iv !== null && hv20 !== null && hv20 > 0 ? Math.round((iv / hv20) * 100) / 100 : null;
  if (ivToHv === null && ivRank === null) return { regime: "unknown", ivToHv };
  const { ivRich, ivCheap } = STRATEGY_RULES;
  if ((ivToHv !== null && ivToHv >= ivRich.ivToHv) || (ivRank !== null && ivRank >= ivRich.ivRank)) {
    return { regime: "rich", ivToHv };
  }
  if (
    (ivToHv === null || ivToHv < ivCheap.ivToHv) &&
    (ivRank === null || ivRank < ivCheap.ivRank)
  ) {
    return { regime: "cheap", ivToHv };
  }
  return { regime: "fair", ivToHv };
}

/**
 * Pick the eligible strategy families for one horizon. Pure; every branch is
 * pinned by lib/strategy-rules.test.ts.
 */
export function selectFamilies(input: RegimeInput): Selection {
  const notes: string[] = [];
  const biasScore =
    (input.trend ? TREND_SCORE[input.trend] : 0) + (input.momentum ? MOMENTUM_SCORE[input.momentum] : 0);
  if (!input.trend || !input.momentum) notes.push("No trend/momentum rating: treated as neutral.");
  const bias: Bias =
    biasScore >= STRATEGY_RULES.biasThreshold
      ? "bullish"
      : biasScore <= -STRATEGY_RULES.biasThreshold
        ? "bearish"
        : "neutral";
  const { regime, ivToHv } = ivRegime(input.iv, input.ivRank, input.hv20);
  const window = STRATEGY_RULES.horizons[input.horizon];
  const spansEarnings =
    input.daysToEarnings !== null && input.daysToEarnings >= 0 && input.daysToEarnings <= window.maxDte;
  const earningsMode: EarningsMode = spansEarnings ? "spans_earnings" : "none";

  // Theta-positive structures first, in the order the bias suggests.
  let families: StrategyFamily[] =
    bias === "bullish"
      ? [
          "put_credit_spread",
          "put_broken_wing_butterfly",
          "jade_lizard",
          "iron_condor",
          "put_ratio_spread",
          "cash_secured_put",
          "diagonal",
          "call_debit_spread",
        ]
      : bias === "bearish"
        ? ["call_credit_spread", "call_broken_wing_butterfly", "iron_condor", "diagonal", "put_debit_spread"]
        : [
            "iron_condor",
            "iron_butterfly",
            "long_butterfly",
            "put_broken_wing_butterfly",
            "call_broken_wing_butterfly",
            "calendar",
            "double_diagonal",
            "jade_lizard",
          ];

  // Debit spreads only when the setup demands direction: strong bias, or cheap IV.
  const strong = Math.abs(biasScore) >= STRATEGY_RULES.strongBias;
  if (regime === "rich" || (!strong && regime !== "cheap")) {
    families = families.filter((f) => !DEBIT_DIRECTIONAL.has(f));
  }
  if (regime === "rich") notes.push("IV rich versus realized: premium-selling structures preferred.");
  if (regime === "cheap") {
    notes.push("IV cheap versus realized: debit spreads and time spreads allowed.");
    if (!families.includes("calendar")) families.push("calendar");
  }

  if (spansEarnings) {
    // Premium is inflated into the event and crushes after it: sell it with
    // short strikes outside the expected move, or own the back month.
    families = families.filter((f) => !DEBIT_DIRECTIONAL.has(f) && f !== "diagonal");
    if (!families.includes("calendar")) families.push("calendar");
    notes.push(
      "Earnings inside the window: only IV-crush structures, short strikes outside the expected move, or a calendar across the event."
    );
  }

  if (input.risk === "very_high") {
    families = families.filter((f) => !NOT_WIDTH_DEFINED.has(f));
    notes.push("Risk rated very high: only structures whose loss is capped by strike width.");
  }

  return {
    horizon: input.horizon,
    bias,
    bias_score: biasScore,
    iv_regime: regime,
    iv_to_hv: ivToHv,
    earnings_mode: earningsMode,
    families: [...new Set(families)],
    notes,
  };
}

/** Horizon for a front expiry `dte` days out, or null if outside every window. */
export function horizonForDte(dte: number): Horizon | null {
  for (const h of HORIZONS) {
    const w = STRATEGY_RULES.horizons[h];
    if (dte >= w.minDte && dte <= w.maxDte) return h;
  }
  return null;
}
