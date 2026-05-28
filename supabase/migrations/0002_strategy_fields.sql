-- Add new fields for cost/credit, current value, and collateral
ALTER TABLE strategies
  ADD COLUMN collateral_cents integer,
  ADD COLUMN current_value_cents integer;
