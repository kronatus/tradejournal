-- Create enums
CREATE TYPE strategy_kind AS ENUM (
  'long_call',
  'long_put',
  'short_call',
  'short_put',
  'vertical',
  'iron_condor',
  'calendar',
  'straddle',
  'strangle',
  'custom'
);

CREATE TYPE trade_source AS ENUM ('manual', 'csv_import');

CREATE TYPE broker AS ENUM (
  'tastytrade',
  'tos',
  'schwab',
  'fidelity',
  'ibkr',
  'robinhood',
  'generic'
);

CREATE TYPE option_type AS ENUM ('call', 'put');
CREATE TYPE option_side AS ENUM ('long', 'short');

-- Strategies table
CREATE TABLE strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  underlying text NOT NULL,
  strategy_kind strategy_kind NOT NULL,
  conviction smallint CHECK (conviction >= 1 AND conviction <= 5),
  thesis text,
  post_mortem text,
  planned_stop_cents integer,
  planned_target_cents integer,
  mistake_tags text[] DEFAULT '{}',
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  source trade_source DEFAULT 'manual',
  import_batch_id uuid,
  external_group_ref text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_strategies_user_id ON strategies(user_id);
CREATE INDEX idx_strategies_closed_at ON strategies(closed_at);
CREATE UNIQUE INDEX idx_strategies_external_group_ref ON strategies(user_id, external_group_ref)
  WHERE external_group_ref IS NOT NULL;

-- Legs table
CREATE TABLE legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  occ_symbol text NOT NULL,
  option_type option_type NOT NULL,
  strike_cents integer NOT NULL,
  expiry date NOT NULL,
  side option_side NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  entry_price_cents integer NOT NULL,
  exit_price_cents integer,
  entry_at timestamptz NOT NULL,
  exit_at timestamptz,
  fees_cents integer DEFAULT 0,
  entry_delta numeric,
  entry_gamma numeric,
  entry_theta numeric,
  entry_vega numeric,
  entry_iv numeric,
  exit_delta numeric,
  exit_gamma numeric,
  exit_theta numeric,
  exit_vega numeric,
  exit_iv numeric,
  external_open_fill_id text,
  external_close_fill_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_legs_strategy_id ON legs(strategy_id);
CREATE UNIQUE INDEX idx_legs_external_open_fill_id ON legs(strategy_id, external_open_fill_id)
  WHERE external_open_fill_id IS NOT NULL;
CREATE UNIQUE INDEX idx_legs_external_close_fill_id ON legs(strategy_id, external_close_fill_id)
  WHERE external_close_fill_id IS NOT NULL;

-- Import batches table
CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker broker NOT NULL,
  filename text NOT NULL,
  row_count integer NOT NULL,
  fill_count integer NOT NULL,
  strategy_count integer NOT NULL,
  skipped_count integer NOT NULL,
  raw_csv text NOT NULL,
  column_mapping jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_import_batches_user_id ON import_batches(user_id);

-- Add foreign key from strategies to import_batches
ALTER TABLE strategies
  ADD CONSTRAINT fk_strategies_import_batch_id
  FOREIGN KEY (import_batch_id)
  REFERENCES import_batches(id) ON DELETE CASCADE;

-- RLS policies
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own strategies"
  ON strategies
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own strategies"
  ON strategies
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own strategies"
  ON strategies
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own strategies"
  ON strategies
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view legs of their strategies"
  ON legs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM strategies
      WHERE strategies.id = legs.strategy_id
        AND strategies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert legs for their strategies"
  ON legs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM strategies
      WHERE strategies.id = legs.strategy_id
        AND strategies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update legs of their strategies"
  ON legs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM strategies
      WHERE strategies.id = legs.strategy_id
        AND strategies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete legs of their strategies"
  ON legs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM strategies
      WHERE strategies.id = legs.strategy_id
        AND strategies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their own import batches"
  ON import_batches
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own import batches"
  ON import_batches
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own import batches"
  ON import_batches
  FOR DELETE
  USING (auth.uid() = user_id);
