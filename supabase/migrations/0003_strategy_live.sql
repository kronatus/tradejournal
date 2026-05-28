-- Add min/max value tracking for live market data
ALTER TABLE strategies
  ADD COLUMN min_value_cents integer,
  ADD COLUMN max_value_cents integer;
