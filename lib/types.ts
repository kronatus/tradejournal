import type {
  Article,
  SweepHighlight,
  SweepNews,
  SweepPick,
  SweepTrend,
  Technicals,
  TickerSnapshot,
} from "./schemas";
import type { ScanDigest } from "./market-scan";
import type { Economics, LegSide, OptionType, Sizing } from "./strategy-economics";

export const STRATEGY_KINDS = [
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
] as const;

export type StrategyKind = (typeof STRATEGY_KINDS)[number];

export type Leg = {
  id: string;
  strategy_id: string;
  occ_symbol: string;
  option_type: "call" | "put";
  strike_cents: number;
  expiry: string;
  side: "long" | "short";
  qty: number;
  entry_price_cents: number;
  exit_price_cents: number | null;
  entry_at: string;
  exit_at: string | null;
  fees_cents: number;
  entry_delta: number | null;
  entry_gamma: number | null;
  entry_theta: number | null;
  entry_vega: number | null;
  entry_iv: number | null;
  exit_delta: number | null;
  exit_gamma: number | null;
  exit_theta: number | null;
  exit_vega: number | null;
  exit_iv: number | null;
  external_open_fill_id: string | null;
  external_close_fill_id: string | null;
  created_at: string;
};

export type Strategy = {
  id: string;
  user_id: string;
  underlying: string;
  strategy_kind: StrategyKind;
  conviction: number | null;
  thesis: string | null;
  post_mortem: string | null;
  planned_stop_cents: number | null;
  planned_target_cents: number | null;
  collateral_cents: number | null;
  current_value_cents: number | null;
  min_value_cents: number | null;
  max_value_cents: number | null;
  entry_net_delta: number | null;
  entry_net_gamma: number | null;
  entry_net_theta: number | null;
  entry_net_vega: number | null;
  entry_net_iv: number | null;
  current_net_delta: number | null;
  current_net_gamma: number | null;
  current_net_theta: number | null;
  current_net_vega: number | null;
  current_net_iv: number | null;
  current_net_at: string | null;
  close_net_delta: number | null;
  close_net_gamma: number | null;
  close_net_theta: number | null;
  close_net_vega: number | null;
  close_net_at: string | null;
  mistake_tags: string[];
  opened_at: string;
  closed_at: string | null;
  source: "manual" | "csv_import";
  import_batch_id: string | null;
  external_group_ref: string | null;
  created_at: string;
  updated_at: string;
  legs?: Leg[];
};

export type Database = {
  public: {
    Tables: {
      strategies: { Row: Strategy };
      legs: { Row: Leg };
    };
  };
};

// --- Research & Market Pulse (migration 0007) ------------------------------

export type ResearchTicker = {
  id: string;
  user_id: string;
  symbol: string;
  sector: string | null;
  industry: string | null;
  setup: string | null;
  notes: string | null;
  sort_order: number;
  added_by: "user" | "claude";
  created_at: string;
  updated_at: string;
};

export type TickerReport = {
  id: string;
  user_id: string;
  symbol: string;
  as_of: string;
  created_at: string;
  snapshot: TickerSnapshot;
  technicals: Technicals | null;
  fundamentals: string | null;
  articles: Article[];
  next_earnings_date: string | null;
  model_notes: string | null;
};

export type MarketSweep = {
  id: string;
  user_id: string;
  scan_date: string | null;
  as_of: string;
  created_at: string;
  headline: string;
  regime: string | null;
  summary: string;
  highlights: SweepHighlight[];
  picks: SweepPick[];
  trends: SweepTrend[];
  /** Absent on sweeps saved before migration 0008. */
  news?: SweepNews[];
};

// --- Options strategies (migration 0009) ----------------------------------

export type StrategyIdeaLeg = {
  side: LegSide;
  ratio: number;
  type: OptionType;
  strike_cents: number;
  expiry: string;
  /** Storage-format OCC symbol; null for tickers OCC storage cannot encode. */
  occ_symbol: string | null;
  bid_cents: number;
  ask_cents: number;
  fill_cents: number;
  iv: number | null;
  open_interest: number | null;
  spread_pct: number | null;
};

export type StrategyIdea = {
  rank: number;
  family: string;
  label: string;
  name: string | null;
  horizon: "short" | "long";
  front_expiry: string;
  dte: number;
  legs: StrategyIdeaLeg[];
  economics: Economics;
  sizing: Sizing | null;
  liquidity: { max_spread_pct: number | null; flags: string[] };
  flags: string[];
  score: number;
  /** [price_cents, pnl_cents per unit] at the front expiry. */
  payoff: [number, number][];
  rationale: string;
  catalysts: string[];
  risks: string[];
  exit_plan: string;
};

export type StrategySetSummary = {
  evaluated: number;
  passed: number;
  rejected: Record<string, number>;
};

export type StrategySet = {
  id: string;
  user_id: string;
  symbol: string;
  as_of: string;
  created_at: string;
  horizons: string[];
  reference_price_cents: number;
  reference_at: string;
  account_value_cents: number;
  /** StrategyContext from lib/strategy-engine.ts at save time. */
  regime: Record<string, unknown>;
  ideas: StrategyIdea[];
  no_setup_reason: string | null;
  rejected_summary: StrategySetSummary;
  model_notes: string | null;
};

export type McpToken = {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/** One end-of-day bar, prices in integer cents. */
export type MarketBar = {
  date: string;
  symbol: string;
  open_cents: number;
  high_cents: number;
  low_cents: number;
  close_cents: number;
  vwap_cents: number | null;
  volume: number;
};

export type MarketScanRow = {
  scan_date: string;
  computed_at: string;
  weighting: "cap" | "equal";
  digest: ScanDigest;
};
