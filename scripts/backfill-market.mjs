#!/usr/bin/env node
/**
 * One-time (or occasional) backfill of end-of-day history for the market scan.
 *
 * Drives the app's own ingest route, so the logic lives in one place:
 *
 *   APP_URL=https://your-app.vercel.app CRON_SECRET=... \
 *     node scripts/backfill-market.mjs --days 70
 *
 * APP_URL defaults to http://localhost:3000 (run `npm run dev` first; the dev
 * server then needs MASSIVE_API_KEY, CRON_SECRET and the Supabase keys in
 * .env.local). CRON_SECRET is read from the environment or .env.local.
 *
 * The free Massive plan allows 5 calls/minute, so the script asks for 4
 * sessions per call and waits ~65s between calls: 70 sessions ≈ 18 minutes.
 * 70 sessions covers the scan's 20/50-day metrics and ~3-month highs/lows.
 * Safe to re-run: stored sessions are skipped.
 */
import { readFileSync, existsSync } from "node:fs";

function envFromFile() {
  if (!existsSync(".env.local")) return {};
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
  );
}

const fileEnv = envFromFile();
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || fileEnv.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("CRON_SECRET is required (env or .env.local)");
  process.exit(1);
}

const argDays = process.argv.indexOf("--days");
const days = argDays > -1 ? Number(process.argv[argDays + 1]) : 70;
if (!Number.isInteger(days) || days < 1 || days > 500) {
  console.error("--days must be an integer between 1 and 500");
  process.exit(1);
}

// Start `days` weekdays back from today (US Eastern).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
let from = today;
for (let n = 0; n < days; ) {
  from = addDays(from, -1);
  const dow = new Date(`${from}T00:00:00Z`).getUTCDay();
  if (dow !== 0 && dow !== 6) n++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`Backfilling ${APP_URL} from ${from} (${days} sessions)…`);

let calls = 0;
for (;;) {
  const res = await fetch(`${APP_URL}/api/market/ingest?from=${from}&max_days=4`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, body.error ?? body);
    process.exit(1);
  }
  calls++;
  const got = body.ingested.map((d) => `${d.date}(${d.bars})`).join(" ");
  console.log(
    `#${calls} planned ${body.planned.join(",") || "-"} | stored ${got || "-"} | empty ${body.empty.join(",") || "-"}` +
      (body.stoppedEarly ? ` | ${body.stoppedEarly}` : "")
  );
  if (!body.planned.length) break;
  // Next run starts after the last session this run looked at, so holidays
  // (always empty) are not asked for again.
  if (!body.stoppedEarly) from = addDays(body.planned[body.planned.length - 1], 1);
  if (from > today) break;
  await sleep(65_000);
}

// History behind the latest session changed, so recompute its scan.
await sleep(1_000);
const res = await fetch(`${APP_URL}/api/market/ingest?max_days=1&rescan=1`, {
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
console.log("Rescanned latest session:", (await res.json()).scanned);
console.log("Done.");
