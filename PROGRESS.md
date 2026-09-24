# Progress Tracker

Last updated: 2026-05-27 (Phase 8 shipped)

## Phase 1: Core Trade Journal (MVP) ✅ COMPLETE
- [x] Supabase schema (strategies, legs, import_batches tables) — migration 0001
- [x] Trade insertion via manual form (`/trades/new`)
- [x] Trade listing (`/trades`) with filters and sorting
- [x] Trade detail view (`/trades/[id]`)
  - Fixed `params` not awaited (Next.js 15+ requirement)
  - Removed non-existent `quotes(*)` relation from Supabase query
  - Fixed leg P&L calculation (was missing ×100 multiplier and side direction)
- [x] Authentication (Supabase Auth with login/signup)
- [x] Protected routes
- [x] All calculation functions (`legPnLCents`, `strategyRealizedPnLCents`, `winRate`, etc.) with Vitest tests

## Phase 1b: Bug Fixes & Code Quality ✅ COMPLETE
- [x] Fixed conviction schema (max 1-5, was allowing 1-10)
- [x] Fixed `parseInt` NaN guard on quantity field
- [x] Fixed price formatting inconsistency (now uses `formatCents`)
- [x] Extracted `formatKind` utility (was duplicated 3x)
- [x] Extracted `StatusBadge` component (was duplicated 3x)
- [x] Consolidated duplicate auth guard in header
- [x] Improved error messages and type safety

## Phase 2: Strategy Management ✅ COMPLETE
- [x] Inline edit for Target/Collateral on strategy detail (PATCH `/api/strategies/[id]`)
- [x] Inline close-leg with optional live exit price prefill
- [x] Bulk strategy close (with open-legs handling)
- [x] Add new leg to existing strategy
- [x] Delete strategy (DELETE `/api/strategies/[id]`, hard delete cascades to legs)
- [x] Delete leg inside a strategy (DELETE `/api/legs/[id]`, blocked when only leg remains)

## Phase 3: Dashboard & Graphs ✅ COMPLETE
- [x] Dashboard data pipeline with server-side calculations
- [x] 6 real metrics: Total P&L, Win Rate, Avg Win/Loss, Max Drawdown, Avg Hold
- [x] Equity curve chart with recharts (auto dark mode via CSS tokens)
- [x] Recent strategies table (last 5)

## Phase 4: CSV Import Wizard 🚧 IN PROGRESS
- [x] Broker CSV parsers — TastyTrade, ThinkorSwim, IBKR, Robinhood, generic (Schwab/Fidelity fall back to generic)
- [x] Import API route (`/api/import`) — parses, groups, dedups via `external_group_ref`, matches close fills to open legs
- [x] Fill grouping into strategies (`lib/importers/group.ts`; Robinhood uses underlying+expiry grouping)
- [x] Dedup & validation (skips strategies with existing `external_group_ref`)
- [x] Upload UI page (`/trades/import`) — broker picker + CSV upload + result summary
- [x] Parser tests (`lib/importers/robinhood.test.ts`)
- [ ] Column mapping UI for generic parser (API accepts `columnMapping`, no UI yet)
- [ ] Preview before import (currently writes directly to DB)
- [ ] Dedicated Schwab and Fidelity parsers

## Phase 5.1: Live Current Value & Greeks (On-Demand) ✅ COMPLETE
- [x] New DB columns: `min_value_cents`, `max_value_cents` (migration 0003)
- [x] `GET /api/quotes?strategyId=<id>` route — fetches Tradier live quotes, computes current value + net Greeks
- [x] `<LiveDataPanel>` client component — on-demand "Refresh live data" button, shows Delta/Theta/Current with live values
- [x] Trade detail page — integrates LiveDataPanel for real-time metrics
- [x] Min/max tracking — DB updated automatically when new extremes are hit
- [x] Switched from Polygon (403 Forbidden) to Tradier (free with brokerage account)
  - Batch-fetch multiple symbols in single API call (120 req/min limit)
  - Mid-price fallback when no recent trades: `(bid + ask) / 2`
  - Hourly greeks from ORATS (sufficient for a trade journal)

## Phase 5.2: Strategy Sandbox (What-If Analyzer) ✅ COMPLETE
- [x] Black-Scholes pricing model (`lib/pricing.ts`) with full Greeks (delta, gamma, theta, vega)
- [x] 25 Vitest tests covering all pricing scenarios, edge cases, and Greeks accuracy
- [x] API routes: `/api/sandbox/spot` (equity quotes), `/api/sandbox/quotes` (option prices + IV)
- [x] Interactive charts: P&L payoff diagram (4 time curves), theta decay curve (daily)
- [x] Greeks panel: strategy cards + per-leg breakdown table
- [x] Strategy builder page (`/app/sandbox`) with multi-leg composer
- [x] Scenario controls: spot price slider (±25%), DTE slider (0 to expiration)
- [x] Live price fetching from Tradier for entry prices and IV
- [x] Real-time chart updates and Greeks calculations
- [x] Full TypeScript strict mode compliance, zero lint errors

## Phase 5.3: Auto-refresh Greeks ⏳ DEFERRED
- [ ] Background polling or webhook to refresh Greeks without user action

## Phase 5.4: Greeks Snapshots ✅ COMPLETE (pending DB migration apply)
- [x] Persist Greeks snapshot at entry / refresh / close — strategy-level columns added in migration `0004_greeks_snapshots.sql`
- [x] Detail page Delta/Theta tiles show `Entry:` and `Current:` (or `Close:` on closed strategies) side-by-side; Refresh overwrites `current_net_*` in DB and re-renders
- [x] Closing a strategy writes `close_net_delta/gamma/theta/vega` + `close_net_at` in the same UPDATE that sets `closed_at`
- ⚠️ **Apply `supabase/migrations/0004_greeks_snapshots.sql` to the remote DB** (Supabase dashboard SQL editor or `supabase db push`) — without this, the new write paths will silently fail until the columns exist.

## Phase 8: Deployment ✅ COMPLETE (except migration 0004 pending user action)
- [x] Sweep stale docs (Polygon → Tradier in `README.md` and `.env.example`)
- [x] Push `main` to https://github.com/kronatus/tradejournal (private) — 83 files, full history
- [x] Fix `@testing-library/react` peer dependency for React 19
- [x] Add `.npmrc` with `legacy-peer-deps=true` for Vercel builds
- [x] Fix dashboard null-safety with bulk-imported strategies (884 closed strategies)
- [x] Apply `supabase/migrations/0004_greeks_snapshots.sql` to remote Supabase — confirmed present
- [ ] Apply `supabase/migrations/0005_reconcile_strategy_columns.sql` ← 0002 and 0003 were never applied; this adds their columns idempotently
- [x] Vercel: import project from GitHub via dashboard
- [x] Vercel: add env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADIER_API_TOKEN`)
- [x] Supabase Auth → URL Configuration: set Site URL + add Vercel production & preview URLs to Redirect URLs
- [x] Production smoke-test: login, live data refresh, sandbox scenario, CSV import all working with 884 strategies

---

## 📋 Setup Notes

### Phase 5.1: Tradier API Setup
To use the live data refresh feature, you need a free Tradier brokerage account:

1. Sign up at https://tradier.com (no deposit required)
2. Get your API token at https://dash.tradier.com/settings/api
3. Add to `.env.local`:
   ```
   TRADIER_API_TOKEN=your_production_token_here
   ```

Tradier returns:
- Live options prices (last trade, or mid-price fallback if no recent trades)
- Hourly greeks from ORATS (delta, gamma, theta, vega)
- 120 requests/minute rate limit (plenty for manual trading journal use)

---

## ⏳ Deferred / Future Phases

### Phase 6: Advanced Features
- Post-mortem & mistake tags
- Per-symbol / per-strategy aggregated metrics
- R-multiple, expectancy, profit factor
- Rolling positions as first-class operation
- Screenshot/chart attachments
- Account & broker tagging

### Phase 7: Multi-Account & Stocks/ETFs
- Support multiple accounts
- Stocks and ETFs (not just options)
- Account-level P&L aggregation

---

## Notes

- **SPEC.md** contains the full detailed specification for all planned features
- **CLAUDE.md** contains project conventions and stack info
- **Active plans** are stored in `~/.claude/plans/` — reference there for detailed implementation notes and design decisions
- All code follows strict TypeScript, Tailwind conventions, and includes tests for calculations
