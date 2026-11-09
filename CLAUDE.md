# Trade Journal

Personal web app for logging stock/ETF and options trades, computing
performance metrics, and fetching market quotes for open positions.

## Stack
- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind + shadcn/ui
- Supabase (Postgres + Auth)
- TanStack Query for client-side data fetching
- Zod for validation
- Vitest for tests

## Commands
- `npm run dev` — start dev server
- `npm test` — run Vitest
- `npm run lint` — eslint + typecheck
- `npm run supabase:types` — regenerate src/types/database.ts

**Note:** Use `npm` for all commands, not `pnpm` — pnpm is not available in the CLI environment.

## Conventions
- Use Server Components by default; mark Client Components with `"use client"` only when needed
- All trade calculations live in `src/lib/calculations.ts` (journal P&L) or `lib/strategy-economics.ts` (option-strategy ideas) and MUST have Vitest tests
- External API calls go through `src/app/api/*` routes — never expose API keys to the client
- Validate all form input and all external API responses with Zod schemas from `src/lib/schemas.ts`
- Money is stored as integer cents in the DB, never floats
- Use the Supabase server client in Server Components, browser client only in Client Components

## Gotchas
- **Option symbols (OCC):** read [OCC_SYMBOLOGY.md](OCC_SYMBOLOGY.md) before touching any code that handles them. Two formats coexist (cents in storage vs dollars×1000 for providers), and the conversion is the #1 source of bugs. All conversion lives in `lib/occ.ts` and is covered by `lib/occ.test.ts` — do not re-derive it elsewhere.
- **Market data provider:** Marketdata.app is primary (`MARKETDATA_API_TOKEN`); Tradier is a fallback kept only for deployments that still have a funded brokerage account. `lib/quotes.ts` selects between them; call `fetchQuotes()`/`fetchSpot()`, never a provider client directly.
- **Marketdata billing:** an undated option request costs **one credit per contract returned** against 100/day on the free plan. Quote the legs you hold; never pull a whole chain.
- **Marketdata failure modes:** an unknown or malformed symbol returns `{"s":"no_data"}`, not an error — which is why `toStandardOcc()` throws on bad input. An unrecognised payload shape throws rather than being coerced, so fabricated Greeks can never reach the database.
- Absent Greeks are flagged via `Quote.greeksMissing` and excluded from net Greeks. Zero is a claim; absence is not.
- Tradier `updated_at` may fail strict Zod `.datetime()` validation — use a fresh ISO timestamp instead. Marketdata's `updated` (unix seconds) is trustworthy and IS preserved, because the free feed is delayed and the real mark time matters.

## Research & Market Pulse (live since 2026-11-08)
Tabs `/research` (ticker watchlist + analysis) and `/pulse` (market sweep). **Claude chat does the analysis, the app stores and renders it.**
- **Split of work:** the app computes everything mechanical (market-wide scan, technicals, charts, option-strategy economics) in code; Claude chat (Robinhood MCP + web search, driven by `skills/market-sweep`, `skills/ticker-research` and `skills/options-strategist`, uploaded to claude.ai) does judgment and writes back. The deployed app never calls Robinhood (OAuth/UUID/scope reasons in `reports/Robinhood MCP versus Tradier quotes.md`).
- **App-hosted MCP:** `app/api/mcp/[token]` → `lib/mcp/server.ts` (14 tools, stateless Streamable HTTP, JSON responses, POST only). The path segment is a per-user secret; only its sha256 is in `mcp_tokens` (created/revoked via `app/api/research/token`, UI in Research → Connect Claude). Unknown secret → 404. Tool inputs are the Zod schemas in `lib/schemas.ts` plus cross-field checks `tickerReportProblems` / `sweepProblems` (article and news dates vs `as_of`, ≤36h news, duplicates). **Any schema or tool change must also update `skills/*/SKILL.md`** (and re-zip/re-upload them in claude.ai).
- **Market data:** Massive (ex-Polygon) free Stocks Basic, Grouped Daily = one call for the whole US market per session (`lib/market-data/eod.ts` is the only provider-aware file; `MASSIVE_API_KEY`, 5 calls/min). `lib/market-ingest.ts` fills missing sessions (≤4 per run) into `market_bars` for the universe + all research tickers, then recomputes `market_scans`. Triggered by Vercel cron `0 11 * * 2-6` → `app/api/market/ingest` (`Authorization: Bearer $CRON_SECRET`; `?from=&max_days=&rescan=1` for backfill), by the `refresh_market_data`/`get_market_scan` tools, and by `scripts/backfill-market.mjs` (default 300 sessions, ~80 min, resumable).
- **Scan:** `lib/market-scan.ts` → bounded digest (~14 KB / ~4–5k tokens): breadth, index proxies, sector rotation (rank change), industries, index contributors (bps), ≤25 anomalies with codes REL_VOL, RET_Z, GAP, NEW_HIGH/LOW, SECTOR_DIVERGENCE, QUIET_ACCUMULATION, STREAK. Thresholds live in `SCAN_THRESHOLDS`; `lib/glossary.test.ts` pins the explanations to them. Universe = S&P 500 + Nasdaq-100 (518) + index/sector ETFs in `data/universe.json` (`scripts/refresh-universe.mjs`; `--shares` fills share counts for cap weighting, otherwise equal-weighted).
- **Charts & terms:** `components/research/price-chart.tsx` reads `market_bars` client-side (RLS: signed-in read) and uses `lib/chart-data.ts` + series fns in `lib/technicals.ts` (tests pin series last values to the scalar indicators). One axis per pane, synced crosshair, values in a readout strip — never a floating tooltip over data. `components/ui/term.tsx` + `lib/glossary.ts` give hover/tap explanations; the bubble is placed outside the nearest `[data-term-row]` so it never covers the value.
- **Options strategies (Phase 11):** `get_strategy_context` → Claude pulls the chain slice it asks for from Robinhood → `evaluate_option_strategies` → `save_strategy_set` (separate `strategy_sets` table, latest per symbol wins, shown inside the ticker report). Code picks families (`lib/strategy-rules.ts` selector: trend/momentum × IV vs hv20 × days to earnings, horizons short 0–3 / long 4–21 DTE), builds structures (`lib/strategy-catalog.ts`, short strikes anchored to 20-session support/resistance from `lib/levels.ts`), prices at natural bid/ask and gates them (`lib/strategy-economics.ts`): risk ≤ 3.25× reward, EV > 0 under hv20, one unit ≤ 50% of account (Claude passes the account value), survives a gap of max(20-session gap, ATR). Save re-gates and stores the server's numbers — the model never writes risk numbers. All thresholds in `STRATEGY_RULES`. Management (scale-out, roll-then-cut, review) is Phase 11b.
- **DB:** migrations `0007_research.sql` (research_tickers, ticker_reports, market_sweeps, mcp_tokens — own-row RLS; market_bars, market_scans — shared read-only), `0008_sweep_news.sql` and `0009_strategy_sets.sql` (own-row read/delete, service-role writes). Service-role code in `lib/research-store.ts` must filter by `user_id` explicitly (enforced by its tests).
- **Ops gotchas:** on networks with TLS interception, run node scripts with `--use-system-ca` (never disable TLS verification — scripts send `CRON_SECRET`). On Windows, zip skills with `tar -a -c -f market-sweep.zip market-sweep` (no `zip` binary; old `Compress-Archive` writes backslash paths). Verify a migration locally with PGlite + a stubbed `auth` schema (there is no local Supabase). Setup checklist: `skills/README.md`.

## Workflow
- Run `npm run lint` and `npm test` after any change to `lib/` or `app/api/`
- For DB schema changes: write a new file in `supabase/migrations/`, then regenerate types
- **Debugging**: when investigating runtime issues, run `npm run dev` from Claude's environment using `run_in_background: true`. This lets Claude monitor the server logs directly via the output file, making debug much simpler than asking the user to copy-paste logs.