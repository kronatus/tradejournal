# Trade Journal

Personal options trading journal for tracking performance metrics, managing multi-leg strategies, importing broker CSVs, running live market scans, and generating options strategy ideas.

**Stack:** Next.js 15 · TypeScript · Tailwind · Supabase · TanStack Query · Vitest · PGlite

## Setup

1. Copy `.env.example` to `.env.local` and fill in Supabase + Tradier credentials. Get a Tradier token at https://dash.tradier.com/settings/api (free with brokerage account).
2. Set up Supabase:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT
   npx supabase migration up
   npm run supabase:types
   ```
3. Install dependencies: `npm install --legacy-peer-deps`

## Development

```bash
npm run dev         # Start dev server (localhost:3000)
npm run test        # Run Vitest
npm run lint        # ESLint + TypeScript check
npm run build       # Production build
```

## Features

### Trade journal
- **Options strategies**: single-leg + multi-leg with entry/current/close Greeks snapshots
- **Manual entry**: create trades via `/trades/new`, add legs to existing strategies, inline edit targets/collateral, close legs/strategies, delete legs/strategies
- **Leg management**: new legs inherit ticker from Basics and expiry from first leg; inline edit of Target/Collateral; legs table scrolls horizontally with fixed column widths
- **CSV import**: TastyTrade, ThinkorSwim, IBKR, Robinhood (fully implemented); Schwab/Fidelity fall back to a generic parser; dedup via `external_group_ref`; fill grouping into strategies
- **Metrics**: realized P&L, win rate, avg win/loss, equity curve, max drawdown, holding period
- **Live data**: on-demand Tradier quotes + Greeks (delta, gamma, theta, vega) per leg, with min/max value tracking; batch-fetch (2 at a time) via "Refresh All" button; switched from Polygon (403) to Tradier (free with brokerage account); mid-price fallback `(bid + ask) / 2`

### Dashboard & graphs
- **6 real metrics**: Total P&L, Win Rate, Avg Win/Loss, Max Drawdown, Avg Hold, plus open value, current value, unrealized P&L, realized P&L, and updated timestamp per strategy
- **Equity curve chart** with recharts (auto dark mode via CSS tokens)
- **Recent strategies table** (last 5) expanded to 9 columns
- **Timezone pinning**: all display formatting in US Central (America/Chicago); 24-hour clock (`00:00`–`23:59`)

### Strategy sandbox (what-if analyzer)
- **Black-Scholes pricing model** with full Greeks (delta, gamma, theta, vega)
- **25 Vitest tests** covering all pricing scenarios, edge cases, and Greeks accuracy
- **API routes**: `/api/sandbox/spot` (equity quotes), `/api/sandbox/quotes` (option prices + IV)
- **Interactive charts**: P&L payoff diagram (4 time curves), theta decay curve (daily)
- **Greeks panel**: strategy cards + per-leg breakdown table
- **Strategy builder page** (`/sandbox`) with multi-leg composer
- **Scenario controls**: spot price slider (±25%), DTE slider (0 to expiration)

### Greeks snapshots
- Persist Greeks snapshot at entry / refresh / close
- Detail page Delta/Theta tiles show `Entry:` and `Current:` (or `Close:` on closed strategies) side-by-side
- Closing a strategy writes `close_net_delta/gamma/theta/vega` + `close_net_at` in the same UPDATE that sets `closed_at`

### Theme
- **Light/Dark/System toggle** in header; pinned to localStorage; uses CSS `light-dark()` function
- Inline head script prevents flash of wrong theme on page load
- `useSyncExternalStore` instead of state to avoid cascading renders

### Research & Market Pulse (`/research`, `/pulse`)
- **Market scan**: breadth, sector rotation, industries, index contributors, anomalies with reason codes — computed locally from stored market bars (Claude never sweeps 500+ tickers)
- **EOD ingest**: Massive Grouped Daily (1 call = whole market), daily Vercel cron, resumable backfill script
- **Universe**: S&P 500 + Nasdaq-100 (518 names, GICS) + index/sector ETFs in `data/universe.json`; `scripts/refresh-universe.mjs`
- **Technicals**: SMA/EMA/RSI/MACD/ATR/HV/rel-vol in `lib/technicals.ts`
- **Ticker charts**: price + SMA 20/50/200, volume vs 20-day avg, RSI 14, MACD — synced crosshair with readout strip, 1M–All ranges
- **Glossary bubbles** on technical terms (hover, focus, or tap) — values stay visible
- **News of the day** on Pulse: ≤ 8 headlines ≤ 36h old, with impact + symbol tags
- **MCP server** (`app/api/mcp/[token]`): 14 tools, Zod-validated writes, per-user secret URL, revocable
- **Skills**: `skills/market-sweep`, `skills/ticker-research`, `skills/options-strategist`

### Options strategy framework (Phase 11a)
- **Research-first gate**: strategies require the ticker on the research list with a ticker report ≤ 24 h old
- **15 strategy families**: credit/debit verticals, iron condor (incl. unbalanced), iron fly, long/broken-wing butterflies, jade lizard, 1×2 put ratio, CSP, calendar, diagonal, double diagonal
- **Strategy economics**: natural pricing; max gain/loss read off payoff; breakevens; lognormal PoP and EV under realized and implied vol; net theta; gap test; sizing; model valuation for multi-expiry structures
- **Gating rules**: max loss ≤ 3.25 × max gain; expected P&L > 0 under realized vol; one unit's max loss ≤ 50% of account; gap test doesn't reach max loss
- Ranked by EV ÷ max loss (liquidity-penalised), ≤ 3 ideas, one per family
- **UI**: strategy ideas card with economics, glossary terms, payoff mini-chart, stale badge, "Log as trade" and "Open in Sandbox" actions

### Authentication & deployment
- **Supabase Auth** with login/signup, forgot/reset password flow, protected routes
- **Vercel deployment** with production & preview URLs configured in Supabase Auth redirect URLs
- **Database migrations**: 0001–0009 (strategies, legs, import batches, Greeks snapshots, reconcile columns, research tables, news, strategy sets)

## Project Layout

- `app/` — pages and API routes (including `/api/mcp/[token]`, `/api/sandbox/*`, `/api/quotes`, `/api/import`)
- `components/` — React components (ui/, pulse/, research/, sandbox/, strategy-detail/)
- `lib/` — calculations, schemas, Supabase clients, CSV importers, pricing model, snapshot helpers, technicals, market-scan, strategy engine/rules/catalog/economics, levels, glossary
- `lib/importers/` — broker-specific CSV parsers + grouping logic
- `supabase/migrations/` — SQL schema (run with `supabase migration up`)
- `lib/calculations.ts` / `lib/pricing.ts` — all metrics and BSM pricing (fully tested)
- `data/universe.json` — S&P 500 + Nasdaq-100 universe (518 names)
- `skills/` — Claude skills: market-sweep, ticker-research, options-strategist
- `OCC_SYMBOLOGY.md` — read before touching option symbol code (cents vs. dollars×1000 conversion)
- `PROGRESS.md` — detailed phase-by-phase progress tracker
