# Trade Journal

Personal options trading journal for tracking performance metrics, managing multi-leg strategies, and importing broker CSVs.

**Stack:** Next.js 15 · TypeScript · Tailwind · Supabase · TanStack Query · Vitest

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

- **Options strategies**: single-leg + multi-leg with entry/current/close Greeks snapshots
- **Manual entry**: create trades via `/trades/new`, add legs to existing strategies, inline edit targets/collateral, close legs/strategies, delete legs/strategies
- **CSV import**: TastyTrade, ThinkorSwim, IBKR, Robinhood (fully implemented); Schwab/Fidelity fall back to a generic parser
- **Metrics**: realized P&L, win rate, avg win/loss, equity curve, max drawdown, holding period
- **Live data**: on-demand Tradier quotes + Greeks (delta, gamma, theta, vega) per leg, with min/max value tracking
- **Sandbox** (`/sandbox`): what-if analyzer with Black-Scholes pricing, payoff/theta-decay charts, and per-leg Greeks

## Project Layout

- `app/` — pages and API routes
- `lib/` — calculations, schemas, Supabase clients, CSV importers, pricing model, snapshot helpers
- `supabase/migrations/` — SQL schema (run with `supabase migration up`)
- `lib/calculations.ts` / `lib/pricing.ts` — all metrics and BSM pricing (fully tested)
- `lib/importers/` — broker-specific CSV parsers + grouping logic
- `OCC_SYMBOLOGY.md` — read before touching option symbol code (cents vs. dollars×1000 conversion)
