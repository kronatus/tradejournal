# Trade Journal — SPEC

Personal options-trading journal. v1 scope and data model.
Source: `CLAUDE.md` (stack) + `structure.md` (layout) + answers captured 2026-05-25.

---

## 1. Scope

### In scope (v1)
- **Options only.** Single-leg and multi-leg strategies (verticals, condors, calendars, straddles, custom).
- Manual trade entry.
- **Broker CSV import** with pluggable per-broker parsers, manual column-mapping fallback, fill→strategy grouping, dedup, and per-batch undo.
- Greek snapshots at entry/exit + live Greeks for open positions via Polygon.
- Dashboard with realized-P&L metrics and equity curve.
- Strategy list with expand-on-demand leg view.
- Polygon proxy through `/api/quotes` (free-tier-aware caching).

### Backlog (explicitly deferred)
- Stocks / ETFs.
- R-multiple, expectancy, profit factor (stop/target fields are captured so these are computable later without migration).
- Per-symbol / per-strategy aggregated metrics (tags are captured; computation deferred).
- Screenshot / chart attachments.
- Account / broker tagging.
- Rolling as a first-class operation (v1 models a roll as: close legs on old strategy → open new strategy; per-leg timestamps support this).
- Automated broker sync via API (v1 is CSV-only).

---

## 2. Data model

Three tables: `strategies` (the trade), `legs` (the contracts), and `import_batches` (CSV import provenance). All money is integer **cents**.

### `strategies`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | RLS scoped |
| `underlying` | text | e.g. `AAPL` |
| `strategy_kind` | enum | `long_call`, `long_put`, `short_call`, `short_put`, `vertical`, `iron_condor`, `calendar`, `straddle`, `strangle`, `custom` |
| `conviction` | smallint | 1–5, nullable |
| `thesis` | text | markdown, nullable |
| `post_mortem` | text | markdown, nullable |
| `planned_stop_cents` | int | per-contract net debit/credit stop, nullable |
| `planned_target_cents` | int | per-contract net target, nullable |
| `mistake_tags` | text[] | retrospective tags (`fomo`, `oversized`, `moved_stop`, …) |
| `opened_at` | timestamptz | min of leg `entry_at` |
| `closed_at` | timestamptz | null = open; set when all legs have `exit_at` |
| `source` | enum | `manual`, `csv_import` — provenance |
| `import_batch_id` | uuid FK → import_batches | null for manual entries |
| `external_group_ref` | text | broker's order/group id when known; null otherwise |
| `created_at`/`updated_at` | timestamptz | |

`opened_at` / `closed_at` are derived but materialized for index/sort.
`(user_id, external_group_ref)` has a partial unique index where `external_group_ref` is not null — prevents re-importing the same combo order twice.

### `legs`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `strategy_id` | uuid FK → strategies | cascade delete |
| `occ_symbol` | text | full OCC, e.g. `O:AAPL250117C00150000` |
| `option_type` | enum | `call`, `put` |
| `strike_cents` | int | |
| `expiry` | date | |
| `side` | enum | `long`, `short` |
| `qty` | int | contracts, > 0 |
| `entry_price_cents` | int | per-contract premium paid/received |
| `exit_price_cents` | int | nullable; null = leg still open |
| `entry_at` | timestamptz | |
| `exit_at` | timestamptz | nullable |
| `fees_cents` | int | sum of open + close commissions for this leg |
| `entry_delta`, `entry_gamma`, `entry_theta`, `entry_vega`, `entry_iv` | numeric | snapshot from Polygon at entry, nullable |
| `exit_delta`, `exit_gamma`, `exit_theta`, `exit_vega`, `exit_iv` | numeric | snapshot at exit, nullable |
| `external_open_fill_id` | text | broker fill id for the opening fill, nullable |
| `external_close_fill_id` | text | broker fill id for the closing fill, nullable |
| `created_at` | timestamptz | |

Per-leg timestamps support adjustments and rolls.
`(user_id, external_open_fill_id)` and `(user_id, external_close_fill_id)` each have a partial unique index where the column is not null — prevents the same fill being imported twice across batches.

### `import_batches`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | RLS scoped |
| `broker` | enum | `tastytrade`, `tos`, `schwab`, `fidelity`, `ibkr`, `robinhood`, `generic` |
| `filename` | text | original upload name, for the UI |
| `row_count` | int | rows in source CSV |
| `fill_count` | int | option fills parsed |
| `strategy_count` | int | strategies created |
| `skipped_count` | int | rows skipped (non-option, dupes, errors) |
| `raw_csv` | text | original file contents, kept for re-grouping/audit |
| `column_mapping` | jsonb | only set for `generic`; the user's column → canonical-field map |
| `created_at` | timestamptz | |

Undo = cascade-delete the batch → all strategies/legs created by it are removed.

### RLS
All rows filtered by `user_id = auth.uid()` (strategies) and via join (legs).

---

## 3. Calculations (`src/lib/calculations.ts`)

All functions pure, fully covered by Vitest.

### Per leg
```ts
legPnLCents(leg): number
// realized only if exit_price_cents != null
// = (exit - entry) * qty * 100 * (side === 'long' ? 1 : -1) - fees_cents
```

### Per strategy
```ts
strategyRealizedPnLCents(strategy): number    // sum of closed legs only
isStrategyClosed(strategy): boolean           // all legs have exit_at
strategyNetGreeks(strategy, source): { delta; gamma; theta; vega }
// source = 'entry' | 'exit' | 'live'
// per leg: greek * qty * 100 * (side === 'long' ? 1 : -1), summed
```

### Aggregate (across closed strategies)
```ts
totalRealizedPnLCents(strategies): number
winRate(strategies): number                   // 0..1, closed only
avgWinCents(strategies): number               // mean of strategies with pnl > 0
avgLossCents(strategies): number              // mean of strategies with pnl < 0, returned negative
holdingPeriodDays(strategy): number           // closed_at - opened_at
avgHoldingPeriodDays(strategies, filter?): number  // filter: 'winners' | 'losers' | undefined
equityCurve(strategies): Array<{ date: string; cumulativePnLCents: number }>
// strategies sorted by closed_at; cumulative running sum
maxDrawdownCents(curve): number               // max peak-to-trough drop, returned positive
```

Out-of-scope but the data supports adding later without migration: R-multiple (uses `planned_stop_cents`), expectancy, profit factor, per-tag aggregation.

---

## 4. External API — Polygon

### `/api/quotes` (proxy)
- `GET /api/quotes?occ=O:AAPL250117C00150000`
- Response: `{ price, delta, gamma, theta, vega, iv, asOf }` — validated with `QuoteSchema` (Zod).
- Server-side only; `POLYGON_API_KEY` never reaches the client.
- Endpoint used: Polygon options snapshot (`/v3/snapshot/options/{underlying}/{occ}`).

### Rate-limit strategy (free tier: 5 req/min)
- TanStack Query `staleTime: 60_000` on the client.
- Server route memoizes by OCC for 30s.
- Detail page fetches legs in sequence with a short delay rather than parallel.
- Dashboard / list pages do **not** fetch live quotes — only the detail page does.

### Greek snapshots
- On strategy create: hit `/api/quotes` for each leg, persist `entry_*` Greeks alongside the row.
- On strategy close: same for `exit_*` Greeks.
- For open positions on the detail page: fetch live Greeks; surface alongside the entry snapshot for drift comparison.

---

## 5. Validation (`src/lib/schemas.ts`)

Zod schemas:
- `LegInputSchema` — form input for a single leg (qty > 0, valid OCC, prices ≥ 0, etc.).
- `StrategyInputSchema` — strategy fields + `legs: LegInputSchema[].min(1)`.
- `QuoteSchema` — the shape returned by Polygon (validated server-side before the API route responds).
- `OccSymbolSchema` — regex + helper to parse/build OCC strings; the only place OCC parsing lives (per CLAUDE.md gotcha).
- `CanonicalFillSchema` — the broker-agnostic intermediate every importer emits (see §7).
- `ColumnMappingSchema` — for the generic importer's user-supplied mapping.

---

## 6. UI surface

### `/` — Dashboard
Stats cards: total realized P&L, win rate, avg win, avg loss, max drawdown, avg holding period (winners vs losers).
Equity curve chart (line, x=closed_at, y=cumulative P&L).
"Recent strategies" mini-table (last 10 closed).

### `/trades` — Strategy list
Columns: opened, underlying, strategy_kind, # legs, status (open/closed), realized P&L, conviction.
Each row **expands on demand** to show its legs table (strike, expiry, side, qty, entry, exit, leg P&L) — no separate page needed for quick review.
Filters: status (open/closed), `strategy_kind`, underlying, date range, `mistake_tags`.

### `/trades/import` — CSV import
Step 1: pick broker (preset) or `generic` + upload CSV.
Step 2 (generic only): map columns → canonical fields; mapping is saved on the batch.
Step 3: **preview** — table of parsed fills grouped into proposed strategies, with badges for `dedup-skip` (already imported), `no-group` (no broker order id; user can merge rows manually), `non-option` (skipped). Greeks column is empty at this stage.
Step 4: confirm → server creates the batch, strategies, legs in one transaction; then enqueues Greek snapshot fetches (rate-limit-aware, in the background).
Post-import: batch detail page shows what was created with a single-click **Undo batch** button.

### `/trades/new` — Entry form
Step 1: pick `strategy_kind`. Template seeds the correct number of leg rows with sensible side defaults (e.g. vertical = 1 long + 1 short same-type).
Step 2: per leg — underlying + expiry + strike + type → build OCC via helper. Qty, side, entry price, fees.
Step 3: strategy-level — conviction, thesis, planned stop, planned target.
On submit: persist, then fetch Greeks for each leg server-side and store snapshot.

### `/trades/[id]` — Strategy detail
Header: underlying, strategy_kind, status, realized P&L.
Legs table with leg-level P&L.
**Greeks panel** — for open strategies: net live Greeks + per-leg drift (entry → live); for closed: entry vs exit comparison.
Notes editor (thesis, post-mortem).
Mistake-tag editor.
Actions: close strategy (sets `exit_*` on all open legs, snapshots exit Greeks), close individual leg, delete.

---

## 7. CSV import pipeline

A three-stage pipeline. Each stage is pure (testable) except the persistence step.

### Stage 1 — Parse (per-broker)
Each broker has a parser at `src/lib/importers/<broker>.ts` exporting:
```ts
parse(csvText: string): { fills: CanonicalFill[]; skipped: SkippedRow[] }
```
`CanonicalFill` is broker-agnostic:
```ts
type CanonicalFill = {
  external_fill_id: string;        // dedup key, required
  external_group_ref: string | null; // broker order id when present
  filled_at: Date;
  underlying: string;
  option_type: 'call' | 'put';
  strike_cents: number;
  expiry: string;                  // ISO date
  side: 'long' | 'short';          // derived from broker's buy/sell + open/close
  action: 'open' | 'close';        // BTO/STO = open, STC/BTC = close
  qty: number;                     // contracts, > 0
  price_cents: number;             // per-contract premium
  fees_cents: number;
};
```
Non-option rows (stock fills, dividends, transfers) go to `skipped` with a reason. v1 ships parsers for: `tastytrade`, `tos` (ThinkorSwim), `ibkr`, `robinhood`, plus the `generic` mapper. `schwab` and `fidelity` start as aliases of `generic`; promoted to dedicated parsers as samples come in.

### Stage 2 — Group (broker-agnostic)
`groupFillsIntoStrategies(fills: CanonicalFill[]): ProposedStrategy[]`
- Fills sharing `external_group_ref` group into one strategy (combo orders).
- Fills without a group ref: each becomes its own single-leg strategy. The preview UI lets the user merge rows manually before commit (writes a synthetic `external_group_ref = batch_id + ":" + index`).
- Within a group, opens become legs; closes are matched to prior opens by `(underlying, expiry, strike, option_type, side)` and populate `exit_*` on the matching leg.
- An unmatched close (no prior open in this import) is surfaced as a warning in the preview — user picks an existing open strategy to attach it to, or skips.

### Stage 3 — Persist
Server action / route handler `POST /api/import`:
1. Validate every fill with `CanonicalFillSchema`.
2. Pre-filter dupes: any `external_fill_id` already present for this user → mark `dedup-skip`, exclude.
3. Single DB transaction: insert `import_batches` row, then `strategies` + `legs`. On unique-constraint conflict (race), the whole batch rolls back.
4. After commit: fire-and-forget background job snapshots Greeks for each leg's `entry_at` (and `exit_at` if present), respecting Polygon's 5/min limit. Failed snapshots leave the Greek columns null — they can be retried per-leg from the detail page.

### Strategy-kind inference
After grouping, `strategy_kind` is inferred from the leg shape:
- 1 leg long call/put → `long_call` / `long_put`.
- 1 leg short → `short_call` / `short_put`.
- 2 legs same expiry, opposite sides, same type → `vertical`.
- 2 legs same expiry, both long, call+put same strike → `straddle`; different strikes → `strangle`.
- 4 legs 2-call + 2-put same expiry → `iron_condor`.
- Different expiries → `calendar`.
- Else → `custom`. User can override in the preview.

---

## 8. File layout deltas vs `structure.md`

Add to `src/lib/`:
- `calculations.ts` — as above.
- `schemas.ts` — as above (includes `CanonicalFillSchema`, `ColumnMappingSchema`).
- `quotes.ts` — Polygon client + OCC helper.
- `greeks.ts` — strategy-level Greek aggregation (split out for testability).
- `importers/` — one file per broker (`tastytrade.ts`, `tos.ts`, `ibkr.ts`, `robinhood.ts`, `generic.ts`), plus:
  - `importers/index.ts` — broker registry + dispatch.
  - `importers/group.ts` — Stage 2 grouping logic.
  - `importers/infer-kind.ts` — strategy-kind inference.

Add to `src/components/`:
- `strategy-form.tsx` (replaces `trade-form.tsx`).
- `strategy-table.tsx` with expandable rows (replaces `trade-table.tsx`).
- `legs-subtable.tsx`.
- `greeks-panel.tsx`.
- `equity-curve.tsx`.
- `import-wizard.tsx` — drives the 4-step `/trades/import` flow.
- `column-mapper.tsx` — generic-broker column mapping UI.
- `import-preview.tsx` — preview table with merge / override / skip controls.

Add to `src/app/api/`:
- `import/route.ts` — accepts parsed-and-grouped payload, runs Stage 3.

Add to `supabase/migrations/`:
- `0001_init.sql` — tables, enums, RLS policies, partial unique indexes for dedup.

Add to `tests/fixtures/csv/`:
- One sample CSV per supported broker. Each importer has a Vitest snapshot test against its fixture.

---

## 9. Open questions

1. **Multi-account P&L** — out of scope, but if added later, `strategies.account_id` is the only field change needed.
2. **Assignment / exercise** — v1 treats assignment as a manual close at intrinsic value entered by the user. No special status. (Some broker CSVs report assignments as a synthetic fill — parsers will map these to `action: 'close'` at the strike price.)
3. **Currency** — USD only. No FX.
