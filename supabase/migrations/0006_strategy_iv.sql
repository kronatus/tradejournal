-- Strategy-level implied volatility (vega-weighted across legs, decimal e.g. 0.21)
-- at entry and at last refresh. Trades opened before this migration have no
-- entry IV; it cannot be reconstructed, so the UI shows a dash for them.
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS entry_net_iv   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_iv numeric;
