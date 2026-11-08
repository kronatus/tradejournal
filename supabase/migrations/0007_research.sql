-- Research + Market Pulse.
--
-- Per-user tables (RLS: own rows only):
--   research_tickers  the editable ticker list on /research
--   ticker_reports    Claude's per-ticker analysis, append-only (latest wins)
--   market_sweeps     Claude's market narrative on /pulse
--   mcp_tokens        hashed secrets for the app-hosted MCP connector
--
-- Shared market data (any signed-in user reads, only the service role writes):
--   market_bars       end-of-day OHLCV per symbol, from the EOD provider
--   market_scans      the deterministic scan digest computed from market_bars
--
-- Money is integer cents everywhere, including inside jsonb payloads.

-- ---------------------------------------------------------------------------
-- research_tickers
-- ---------------------------------------------------------------------------
CREATE TABLE research_tickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  sector text,
  industry text,
  -- Trend / opportunity tag (e.g. "Uptrend pullback"). Unused by the UI until
  -- the hierarchical grouping lands; Claude may already fill it.
  setup text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  added_by text NOT NULL DEFAULT 'user' CHECK (added_by IN ('user', 'claude')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);

CREATE INDEX idx_research_tickers_user ON research_tickers(user_id);

-- ---------------------------------------------------------------------------
-- ticker_reports
-- ---------------------------------------------------------------------------
CREATE TABLE ticker_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  -- When the underlying data was marked (not when the row was written).
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  technicals jsonb,
  fundamentals text,
  articles jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_earnings_date date,
  model_notes text
  -- Options strategy ideas are deliberately absent: a later migration adds
  -- them once the strategy framework is defined.
);

CREATE INDEX idx_ticker_reports_user_symbol
  ON ticker_reports(user_id, symbol, created_at DESC);

-- ---------------------------------------------------------------------------
-- market_sweeps
-- ---------------------------------------------------------------------------
CREATE TABLE market_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The market_scans day the sweep was based on, when there was one.
  scan_date date,
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  headline text NOT NULL,
  regime text,
  summary text NOT NULL,
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  picks jsonb NOT NULL DEFAULT '[]'::jsonb,
  trends jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX idx_market_sweeps_user ON market_sweeps(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- mcp_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- sha256 hex of the secret; the secret itself is shown once and never stored.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL DEFAULT 'Claude',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX idx_mcp_tokens_user ON mcp_tokens(user_id);

-- ---------------------------------------------------------------------------
-- market_bars / market_scans (shared)
-- ---------------------------------------------------------------------------
CREATE TABLE market_bars (
  date date NOT NULL,
  symbol text NOT NULL,
  open_cents integer NOT NULL,
  high_cents integer NOT NULL,
  low_cents integer NOT NULL,
  close_cents integer NOT NULL,
  vwap_cents integer,
  volume bigint NOT NULL,
  PRIMARY KEY (date, symbol)
);

CREATE INDEX idx_market_bars_symbol_date ON market_bars(symbol, date DESC);

CREATE TABLE market_scans (
  scan_date date PRIMARY KEY,
  computed_at timestamptz NOT NULL DEFAULT now(),
  weighting text NOT NULL CHECK (weighting IN ('cap', 'equal')),
  digest jsonb NOT NULL
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE research_tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticker_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sweeps ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_scans ENABLE ROW LEVEL SECURITY;

-- research_tickers: full CRUD on own rows (the sidebar adds/removes directly).
CREATE POLICY "Users can view their own research tickers"
  ON research_tickers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own research tickers"
  ON research_tickers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own research tickers"
  ON research_tickers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own research tickers"
  ON research_tickers FOR DELETE USING (auth.uid() = user_id);

-- ticker_reports / market_sweeps: written by the MCP route (service role);
-- the browser reads and may delete its own.
CREATE POLICY "Users can view their own ticker reports"
  ON ticker_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own ticker reports"
  ON ticker_reports FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own market sweeps"
  ON market_sweeps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own market sweeps"
  ON market_sweeps FOR DELETE USING (auth.uid() = user_id);

-- mcp_tokens: created by an API route (service role) so the secret never
-- passes through a client insert; the browser lists and revokes.
CREATE POLICY "Users can view their own mcp tokens"
  ON mcp_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own mcp tokens"
  ON mcp_tokens FOR DELETE USING (auth.uid() = user_id);

-- Shared market data: read-only for signed-in users.
CREATE POLICY "Signed-in users can read market bars"
  ON market_bars FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in users can read market scans"
  ON market_scans FOR SELECT TO authenticated USING (true);
