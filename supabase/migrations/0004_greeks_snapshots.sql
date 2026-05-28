-- Strategy-level Greeks snapshots at entry, last refresh, and close.
-- See plan: Phase 5.4 — Greeks Snapshots.
ALTER TABLE strategies
  ADD COLUMN entry_net_delta   numeric,
  ADD COLUMN entry_net_gamma   numeric,
  ADD COLUMN entry_net_theta   numeric,
  ADD COLUMN entry_net_vega    numeric,
  ADD COLUMN current_net_delta numeric,
  ADD COLUMN current_net_gamma numeric,
  ADD COLUMN current_net_theta numeric,
  ADD COLUMN current_net_vega  numeric,
  ADD COLUMN current_net_at    timestamptz,
  ADD COLUMN close_net_delta   numeric,
  ADD COLUMN close_net_gamma   numeric,
  ADD COLUMN close_net_theta   numeric,
  ADD COLUMN close_net_vega    numeric,
  ADD COLUMN close_net_at      timestamptz;
