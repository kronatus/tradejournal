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
  current_net_delta: number | null;
  current_net_gamma: number | null;
  current_net_theta: number | null;
  current_net_vega: number | null;
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
