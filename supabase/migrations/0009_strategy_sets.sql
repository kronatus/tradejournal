-- Options strategy ideas (Phase 11), written by the options-strategist skill
-- through the MCP save_strategy_set tool and shown inside the ticker report on
-- /research. Append-only; the latest set per symbol wins, so a strategies-only
-- refresh never rewrites the rest of the report.
--
-- Every risk number in `ideas` (max gain/loss, R:R, PoP, EV, sizing) is
-- computed server-side by lib/strategy-economics.ts from the quotes in the
-- request; the model only supplies legs, quotes and prose.

CREATE TABLE IF NOT EXISTS strategy_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  -- When the analysis was done.
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  horizons text[] NOT NULL DEFAULT '{}',
  -- The underlying price the set is priced off, and when it was marked: a set
  -- is stale once the price has moved away from it.
  reference_price_cents bigint NOT NULL,
  reference_at timestamptz NOT NULL,
  account_value_cents bigint NOT NULL,
  -- Selector inputs/outputs, levels, gap size, warnings.
  regime jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ≤ 3 ranked ideas (legs, quotes, economics, payoff, rationale).
  ideas jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Set when nothing cleared the gate ("no compliant setup").
  no_setup_reason text,
  -- {evaluated, passed, rejected: {reason: count}}
  rejected_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_notes text
);

CREATE INDEX IF NOT EXISTS idx_strategy_sets_user_symbol
  ON strategy_sets(user_id, symbol, created_at DESC);

ALTER TABLE strategy_sets ENABLE ROW LEVEL SECURITY;

-- Written by the MCP route (service role); the browser reads and may delete its own.
DROP POLICY IF EXISTS "Users can view their own strategy sets" ON strategy_sets;
CREATE POLICY "Users can view their own strategy sets"
  ON strategy_sets FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own strategy sets" ON strategy_sets;
CREATE POLICY "Users can delete their own strategy sets"
  ON strategy_sets FOR DELETE USING (auth.uid() = user_id);
