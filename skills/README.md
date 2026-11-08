# Claude chat skills for Research & Market Pulse

Two skills teach Claude chat how to fill the journal's **Research** and
**Pulse** tabs. Claude does the analysis with your Robinhood connector and web
search, and writes results through the journal's own MCP connector.

| Skill | Trigger phrases | Writes |
|---|---|---|
| `market-sweep` | "Run a market sweep", "what's the market doing" | Pulse tab |
| `ticker-research` | "Run ticker research on NVDA", "Refresh my research list" | Research tab |

## One-time setup

### 1. Database (production Supabase)

1. In Supabase → **SQL Editor**, check earlier migrations are applied:
   ```sql
   select column_name from information_schema.columns
   where table_name = 'strategies' order by column_name;
   ```
   You should see `entry_net_delta`, `current_net_iv` etc. If not, run
   `0004`–`0006` from `supabase/migrations/` first, in order.
2. Paste and run `supabase/migrations/0007_research.sql`.
   (Alternative with the CLI: `npx supabase link --project-ref <ref>` then
   `npx supabase db push`.)

### 2. Market data (free)

1. Sign up at massive.com (formerly Polygon.io) and copy your API key — the
   free **Stocks Basic** plan is enough.
2. Quick check that the free plan includes the endpoint the scan uses:
   ```bash
   curl "https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/2026-11-06?adjusted=true&apiKey=YOUR_KEY" | head -c 300
   ```
   Expect `"status":"OK"` and a `results` array.
3. In Vercel → Project → Settings → Environment Variables add:
   - `MASSIVE_API_KEY` — the key above
   - `CRON_SECRET` — any long random string (`openssl rand -hex 32`)
4. Redeploy. Vercel → Settings → **Cron Jobs** should list
   `/api/market/ingest` (daily, 11:00 UTC Tue–Sat).

### 3. Backfill history

The scan needs ~70 sessions for its 20/50-day metrics. Run once:

```bash
APP_URL=https://<your-app>.vercel.app CRON_SECRET=<secret> node scripts/backfill-market.mjs --days 70
```

(~18 minutes; the free plan allows 5 calls/minute. Safe to re-run.)

Optional, for cap-weighted index contributions (otherwise equal-weighted):

```bash
MASSIVE_API_KEY=<key> node scripts/refresh-universe.mjs --shares
```

(~2 hours at the free rate limit, resumable; commit the updated
`data/universe.json`. Re-run quarterly.)

### 4. Connect Claude chat

1. Open the journal → **Research** → **Connect Claude** → *Generate connector
   URL*. Copy it (shown once).
2. claude.ai → **Settings → Connectors → Add custom connector** → paste the
   URL. Make sure your Robinhood connector is also enabled.
3. Zip each skill folder and upload it in claude.ai → **Settings →
   Capabilities → Skills**:
   ```bash
   cd skills && zip -r market-sweep.zip market-sweep && zip -r ticker-research.zip ticker-research
   ```
4. In a new chat: **"Run a market sweep"**.

## Notes

- The connector URL is a secret: anyone holding it can read and write your
  research. Revoke it from the Research tab if it leaks.
- The app never calls Robinhood; only Claude chat does, under your own
  Robinhood consent.
- Options strategy ideas are deliberately not part of reports yet.
