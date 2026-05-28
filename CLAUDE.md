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
- All trade calculations live in `src/lib/calculations.ts` and MUST have Vitest tests
- External API calls go through `src/app/api/*` routes — never expose API keys to the client
- Validate all form input and all external API responses with Zod schemas from `src/lib/schemas.ts`
- Money is stored as integer cents in the DB, never floats
- Use the Supabase server client in Server Components, browser client only in Client Components

## Gotchas
- **Option symbols (OCC):** read [OCC_SYMBOLOGY.md](OCC_SYMBOLOGY.md) before touching any code that handles them. Two formats coexist (cents in storage vs dollars×1000 for Tradier), and the conversion is the #1 source of bugs.
- Tradier `updated_at` may fail strict Zod `.datetime()` validation — use a fresh ISO timestamp instead.

## Workflow
- Run `npm run lint` and `npm test` after any change to `lib/` or `app/api/`
- For DB schema changes: write a new file in `supabase/migrations/`, then regenerate types
- **Debugging**: when investigating runtime issues, run `npm run dev` from Claude's environment using `run_in_background: true`. This lets Claude monitor the server logs directly via the output file, making debug much simpler than asking the user to copy-paste logs.