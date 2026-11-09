# Progress Tracker

Last updated: 2026-11-09 (Phase 10 Research & Market Pulse — live)

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

## Phase 8: Deployment ✅ COMPLETE
- [x] Sweep stale docs (Polygon → Tradier in `README.md` and `.env.example`)
- [x] Push `main` to https://github.com/kronatus/tradejournal (private) — 83 files, full history
- [x] Fix `@testing-library/react` peer dependency for React 19
- [x] Add `.npmrc` with `legacy-peer-deps=true` for Vercel builds
- [x] Fix dashboard null-safety with bulk-imported strategies (884 closed strategies)
- [x] Apply `supabase/migrations/0004_greeks_snapshots.sql` to remote Supabase — confirmed present
- [x] Apply `supabase/migrations/0005_reconcile_strategy_columns.sql` — 0002 and 0003 were never applied; migration 0005 adds their columns idempotently
- [x] Vercel: import project from GitHub via dashboard
- [x] Vercel: add env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADIER_API_TOKEN`)
- [x] Supabase Auth → URL Configuration: set Site URL + add Vercel production & preview URLs to Redirect URLs
- [x] Production smoke-test: login, live data refresh, sandbox scenario, CSV import all working with 884 strategies

## Phase 9: UI Polish & Live Data Refinements ✅ COMPLETE
- [x] **Theme switching** — Light/Dark/System toggle in header; pinned to localStorage; uses CSS `light-dark()` function
  - Inline head script prevents flash of wrong theme on page load
  - `useSyncExternalStore` instead of state to avoid cascading renders
  - Validates in all four combinations (OS light/dark × pin light/dark)
- [x] **Dashboard table expansion** — 5 columns → 9 columns: Open value, Current value, Unrealized P&L, Realized P&L, Updated timestamp
  - New calculations: `strategyOpenValueCents()`, `strategyUnrealizedPnLCents()` with proper signed net-liquidation semantics
  - Current value + Unrealized P&L show "—" until first refresh (null ≠ zero)
  - Updated column shows time for today, date for older marks
- [x] **Refresh All button** — Batches all open positions in dashboard, states credit cost upfront, shows live progress
  - Requests go two at a time, not all at once
  - Surfaces `persistError` if a write fails (e.g., missing DB column)
  - Re-runs server components after completion so table shows fresh values
- [x] **Fixed $NaN bug** — `formatCents()` now safely handles null, undefined, and NaN; no $NaN in UI ever
  - `strategyUnrealizedPnLCents()` guards with `== null` (catches undefined) and `!Number.isFinite()`
- [x] **Database reconciliation** — migration 0005 idempotently adds all missing columns from 0002, 0003, 0004
  - Diagnosed root cause: 0002 and 0003 were never applied remotely; 0004 was
  - Current value writes now persist and dashboard populates on refresh
- [x] **Timezone pinning** — All display formatting in US Central (America/Chicago)
  - 16 new tests for formatters validating CST/CDT zone transitions
  - `appZoneTodayUtcMs()` fixes payoff chart off-by-one (was using UTC calendar, not Central)
  - `formatDayOrTime()` shows time for today, date for older marks
  - `datetime-local` inputs still use browser-local wall time (control semantics)
- [x] **Legs table dropdown fixes** — Dropdowns were clipped (12 columns squashing text)
  - Changed to `table-fixed` layout with explicit per-column widths + `min-w-[1180px]` floor
  - Table scrolls horizontally instead of squeezing; verified at 1280, 1024, 820px
  - Cell padding optimized: `px-3 py-2` → `px-2 py-2`
- [x] **Leg inheritance** — New legs inherit ticker from Basics and expiry from first leg
  - Typing the underlying fills empty tickers and corrects those matching previous value
  - Expiry is copied once at add time, allowing calendar spreads to set their own
- [x] **24-hour clock format** — All times now 00:00–23:59 (no AM/PM)
  - Uses `hourCycle: "h23"` to guarantee `00` at midnight (not `24:00`)
  - Tests pin midnight to `00:00`, no meridiem markers across the day
- [x] **Database user query helper** — SQL templates for listing registered users (UID + email)

---

## Phase 10: Research & Market Pulse ✅ LIVE (2026-11-09)

Claude chat does the analysis (Robinhood MCP + web search) and writes it to
the app through an app-hosted MCP server; the app computes the market-wide
scan itself so Claude never sweeps 500+ tickers.

- [x] Migration `0007_research.sql`: `research_tickers`, `ticker_reports`, `market_sweeps`, `mcp_tokens` (RLS own rows), `market_bars` + `market_scans` (shared, read-only to users) — validated in PGlite with RLS checks
- [x] Universe `data/universe.json`: S&P 500 + Nasdaq-100 (518 names, GICS) + index/sector ETFs; `scripts/refresh-universe.mjs`
- [x] EOD ingest from Massive Grouped Daily (1 call = whole market), daily Vercel cron, resumable backfill script
- [x] `lib/technicals.ts` (SMA/EMA/RSI/MACD/ATR/HV/rel-vol…) and `lib/market-scan.ts` (breadth, sector rotation, industries, index contributors, anomalies with reason codes) — bounded digest
- [x] MCP server `app/api/mcp/[token]` — 11 tools, Zod-validated writes, per-user secret URL (hash stored), revocable
- [x] `/research`: grouped editable ticker sidebar (Sector › Industry, pivot presets), snapshot + live spot, key numbers, 4 technical cards, fundamentals, strategies placeholder, ≤5 articles (≤48h)
- [x] `/pulse`: Claude's sweep (regime, highlights, picks → Add to Research, trends) over the computed scan
- [x] Skills `skills/market-sweep`, `skills/ticker-research` + setup guide `skills/README.md`
- [x] Ticker charts: price + SMA 20/50/200, volume vs 20-day avg, RSI 14, MACD — synced crosshair with a readout strip (no floating tooltip over the data), 1M–All ranges, from stored `market_bars`
- [x] Glossary bubbles on technical terms (`lib/glossary.ts`, `components/ui/term.tsx`) — placed outside the label+value row so values stay visible; hover, focus or tap
- [x] News of the day on Pulse (migration `0008_sweep_news.sql`, ≤ 8 headlines ≤ 36h old, impact + symbol tags)
- [x] Prod: 0007 + 0008 applied, `MASSIVE_API_KEY` + `CRON_SECRET` set, 300-session backfill done, connector + skills live in claude.ai and feeding both tabs
- [x] Massive free plan serves Grouped Daily (verified in production)
- [ ] Options strategy framework → moved to Phase 11
- [ ] Optional: fill `shares_outstanding` for cap weighting (`refresh-universe.mjs --shares`)

---

## Phase 11: Options Strategy Framework 📋 NEXT

Fills the "Options strategies" placeholder card on `/research`. Code picks
the strategy type, Claude picks real strikes and expiries from the Robinhood
chain, and the app computes the risk numbers. The model never writes them.

- [ ] Define the framework (open questions): defined-risk only or also short puts / covered calls; typical DTE range; max loss per trade or account size; which strategies are in scope
- [ ] Rules-based selector in `lib/` (trend/momentum ratings × IV regime × days to earnings → candidate strategy types), with Vitest tests
- [ ] `OptionStrategyIdeaSchema` in `lib/schemas.ts` (legs, expiry, DTE, rationale, catalysts, risks) plus cross-checks (expiry vs earnings, leg consistency); OCC handling only via `lib/occ.ts`
- [ ] Server-side risk math reusing `lib/payoff.ts`, `lib/pricing.ts`, `lib/greeks.ts`: max profit/loss, breakevens, probability of profit
- [ ] Migration `0009`: `ticker_reports.strategies jsonb` (≤ 3 ideas), verified in PGlite
- [ ] MCP `save_ticker_report` accepts strategies; update `skills/ticker-research/SKILL.md`, then re-zip and re-upload it
- [ ] UI card: up to 3 ideas with a mini payoff chart, plus "Open in Sandbox" / "Log as trade"
- [ ] Never pull whole chains through Marketdata (billing); chain data comes from Claude's RH calls

---

## Phase 12: Fundamental Analyst Reports 📋 PLANNED

Morningstar-style equity reports, built on our own framework and terminology
(not Morningstar's ratings or names).

- [ ] Define scope (open questions): length (one-page vs multi-page), coverage (research list only?), refresh cadence (after each earnings release?)
- [ ] Framework: fair value estimate (DCF with bear/base/bull scenarios), moat, uncertainty, capital allocation, bull/bear case, key risks, price vs fair value
- [ ] Valuation math in tested code (`lib/valuation.ts`): fair value is computed from inputs Claude cites, never a free-typed number
- [ ] Data sources: RH financials, SEC filing facts, analyst ratings
- [ ] Migration + schema + MCP tool(s) for fundamental reports (own-row RLS, append-only, latest wins)
- [ ] New `skills/fundamental-analyst/SKILL.md` (zip and upload to claude.ai)
- [ ] Full report page per ticker, linked from `/research`

---

## 📋 Setup Notes

### Phase 5.1: Live Market Data Provider Setup
Two APIs are supported (provider chosen automatically based on configured token):

**Marketdata.app (Primary)**
- Sign up at https://marketdata.app (free tier: 100 credits/day, 1 credit per contract)
- Get your API token from the dashboard
- Add to `.env.local`: `MARKETDATA_API_TOKEN=your_token`
- Returns: live option prices, no Greeks (using Black-Scholes locally where needed)

**Tradier (Fallback)**
- Free brokerage account at https://tradier.com (no deposit required)
- Get API token at https://dash.tradier.com/settings/api
- Add to `.env.local`: `TRADIER_API_TOKEN=your_token`
- Returns: live option prices + hourly Greeks from ORATS, 120 req/min rate limit

The app calls `isQuoteProviderConfigured()` and `resolveQuoteProvider()` to pick between them.

### Phase 9: UI/UX Improvements
- Theme toggle persists to localStorage and loads before paint (no flash)
- All timestamps in US Central time (America/Chicago) with zone abbreviations
- Clock format: 24-hour (00:00–23:59)
- Dashboard shows live and persisted values together; Refresh updates everything in one action
- Legs table dropdowns are now fully visible with proper spacing

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

## Summary of Live Data Pipeline

The app now fully supports live market data with proper persistence and display:

1. **Fetch** — On-demand via Refresh button (or Refresh All on dashboard)
2. **Compute** — Per-leg prices + net Greeks (from provider or Black-Scholes)
3. **Persist** — Snapshots at entry/refresh/close; min/max extremes tracked
4. **Display** — Dashboard shows current value + unrealized P&L; detail page shows Delta/Theta entry vs. current
5. **Safety** — Missing DB columns are detected, error messages surfaced; all formatters handle null/NaN safely

**Test coverage:** 150+ Vitest tests covering calculations, pricing, OCC symbols, and timezone logic. API routes and quote fetching have zero test coverage (known gap, marked as high-risk in nextsteps.md).

**Known limitations:**
- No background polling (Phase 5.3 deferred) — refresh is manual only
- No Greek history — only current snapshot + min/max value range
- No per-leg price history — live prices exist only in HTTP response
- Unrealized P&L computed on-demand, not persisted

---

## Notes

- **SPEC.md** contains the full detailed specification for all planned features
- **CLAUDE.md** contains project conventions and stack info
- **OCC_SYMBOLOGY.md** documents the symbol conversion rules (storage vs. provider formats) — read before touching symbol code
- **Active plans** are stored in `~/.claude/plans/` — reference there for detailed implementation notes and design decisions
- All code follows strict TypeScript, Tailwind conventions, and includes tests for calculations
- Marketdata.app integration added in Phase 5.4 (prior context); Tradier kept as fallback for existing users
