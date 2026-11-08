-- Market headlines of the day on the Pulse tab, written by Claude's sweep
-- alongside highlights/picks/trends. Sweeps saved before this have none.
ALTER TABLE market_sweeps
  ADD COLUMN IF NOT EXISTS news jsonb NOT NULL DEFAULT '[]'::jsonb;
