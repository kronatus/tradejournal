# Trade Journal Next Steps

## Current State

Trade Journal is a Next.js App Router options journal using TypeScript, Tailwind, Supabase, Zod, Vitest, and Tradier. The main working surfaces are:

- `/`: server-rendered dashboard with realized P&L metrics, equity curve, and recent strategies.
- `/trades`: server-rendered strategy list with premium, target, current value, conviction, and status.
- `/trades/new`: manual strategy entry.
- `/trades/[id]`: strategy detail, leg table, editing, closing, deletion, and on-demand live data.
- `/trades/import`: broker CSV upload and immediate import result summary.
- `/sandbox`: client-side Black-Scholes what-if analyzer with live Tradier spot/option data.

Core domain logic is split sensibly between `lib/calculations.ts`, `lib/pricing.ts`, `lib/greeks.ts`, `lib/quotes.ts`, `lib/snapshots.ts`, `lib/schemas.ts`, and `lib/importers/`. Supabase migrations define strategies, legs, import batches, live-value tracking, and strategy-level Greek snapshots.

## Important Baseline Notes

- `PROGRESS.md` says the application is deployed and smoke-tested with 884 strategies, but migration `supabase/migrations/0004_greeks_snapshots.sql` still needs to be applied to the remote Supabase database.
- The repository currently uses Next `16.2.6` in `package.json`, while the project notes describe Next 15. Read the installed Next documentation before changing framework APIs.
- The specification and older structure document still mention Polygon and `src/` paths; the implemented application uses Tradier and root-level `app/`, `components/`, and `lib/`. Treat the current code and `PROGRESS.md` as the implementation source of truth, then update stale documentation.
- `npm test -- --run` could not start in the current environment because dependencies are not installed and `vitest` is unavailable. Install dependencies before using the test or lint gates.

## Priority 0: Production Correctness

1. Apply and verify `supabase/migrations/0004_greeks_snapshots.sql` in the remote database. Confirm that entry, current, and close Greek writes work from manual entry, refresh, and close flows.
2. Install dependencies with `npm install`, then run `npm run lint`, `npm test`, and `npm run build` to establish a verified local baseline.
3. Exercise production smoke tests again after the migration: login, create a manual strategy, refresh live data, close a strategy, open the sandbox, and import a small CSV.
4. Review environment variables and production logs for missing or malformed Supabase and Tradier configuration. Keep all provider tokens server-side.

## Priority 1: Finish the CSV Import Workflow

The current import page sends the uploaded CSV directly to `POST /api/import`. The API parses and persists rows sequentially, does not create an `import_batches` record, sets imported strategies to `custom`, and uses a synthesized `underlying|expiry` group reference for deduplication. This does not yet match the preview, fill-level deduplication, inferred strategy kind, transaction, and undo behavior described in `SPEC.md`.

Implement the pipeline in small, testable stages:

1. Extract a shared parse-and-group service that validates every `CanonicalFill` with the schemas, preserves broker group references, applies the broker-specific grouping rule, infers `strategy_kind`, and reports unmatched closes and skipped rows.
2. Add fill-level deduplication using the external fill IDs and existing database uniqueness constraints. Preserve legitimate separate trades that share an underlying and expiry.
3. Add a generic-parser column mapping UI. Validate and persist the mapping in `import_batches.column_mapping`.
4. Add an import preview step showing proposed strategies, fills, skipped rows, duplicate rows, unmatched closes, and strategy-kind overrides. Let users merge ungrouped rows or skip invalid/unmatched data before confirmation.
5. Change confirmation to create one `import_batches` row and all related strategies/legs atomically. Prefer a database transaction/RPC or a server-side transaction boundary; do not leave partial strategies when one leg insert fails.
6. Populate `strategies.import_batch_id`, preserve external open/close fill IDs, correctly match close fills by contract and side, and aggregate fees across matched fills.
7. Add an import-batch detail route and a single-click undo action that deletes only that batch's strategies and legs through the existing cascade relationship.
8. Add parser, grouping, deduplication, and persistence contract tests. Keep broker parser fixtures small and add representative samples for Schwab and Fidelity before promoting them beyond the generic fallback.

## Priority 2: Data and Calculation Hardening

1. Add tests for all importer parsers, grouping edge cases, strategy-kind inference, close matching, duplicate imports, partial fills, multiple fills per leg, and unmatched closes.
2. Add tests for OCC storage versus Tradier conversion using the rules in `OCC_SYMBOLOGY.md`; this is the highest-risk integration boundary.
3. Add focused tests for snapshot aggregation, missing quote behavior, short-leg value signs, and price-to-cents conversion.
4. Review calculation semantics against persisted data, especially closed-strategy detection, multiple partial exits, fees, and strategies with no legs. Avoid mutating caller-owned arrays in calculation helpers such as the equity-curve sort.
5. Regenerate database types after any schema change and keep strict TypeScript and Zod validation at API boundaries.

## Priority 3: Product Completion

1. Add the deferred journal features in a deliberate order: post-mortem and mistake-tag editing, per-symbol/per-kind metrics, expectancy/profit factor/R-multiple, and account/broker tagging.
2. Add filtering and expand-on-demand leg rows to `/trades` to match the specification, including status, strategy kind, underlying, dates, and mistake tags.
3. Improve the detail page's Greek comparison to include all available Greeks and per-leg drift, not only Delta and Theta.
4. Decide whether automatic Greek refresh is worth the operational cost and rate-limit behavior. If yes, add a bounded background job with retries and observability rather than client polling alone.
5. Add accessibility and responsive checks for tables, forms, file upload states, errors, and live-data loading states.

## Suggested Execution Order

1. Install dependencies and establish lint/test/build baseline.
2. Apply and verify migration `0004`.
3. Refactor import parsing/grouping into a pure service and fix fill-level identity, grouping, matching, and kind inference.
4. Build mapping and preview UI around that service.
5. Implement atomic confirmation, import-batch provenance, and undo.
6. Add focused regression tests and run the full validation suite.
7. Update `README.md`, `SPEC.md`, `structure.md`, and `PROGRESS.md` so deployment/provider/path claims describe the current implementation.
8. Re-run production smoke tests and record the result.

## Working Conventions

- Use `npm`, not `pnpm`.
- Keep server components as the default and expose provider credentials only from API routes/server code.
- Store money as integer cents and use the existing schemas for input and external responses.
- Keep calculation changes covered by Vitest tests.
- Read `OCC_SYMBOLOGY.md` before changing option-symbol handling.
- Keep changes focused and run `npm run lint` and `npm test` after changes to `lib/` or `app/api/`.