-- Reconcile the strategies table against migrations 0002-0004.
--
-- A live database was found carrying 0004's Greek-snapshot columns while
-- missing 0002's and 0003's value columns, so the migrations had been applied
-- out of order and incompletely. Reads of the absent columns came back as
-- undefined and surfaced in the UI as "$NaN", and every write to them failed
-- silently.
--
-- Every statement is IF NOT EXISTS, so this is safe to run against a database
-- in any state, including a fully up-to-date one.

-- 0002_strategy_fields
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS collateral_cents integer;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_value_cents integer;

-- 0003_strategy_live
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS min_value_cents integer;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS max_value_cents integer;

-- 0004_greeks_snapshots
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS entry_net_delta   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS entry_net_gamma   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS entry_net_theta   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS entry_net_vega    numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_delta numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_gamma numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_theta numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_vega  numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_net_at    timestamptz;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS close_net_delta   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS close_net_gamma   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS close_net_theta   numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS close_net_vega    numeric;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS close_net_at      timestamptz;
