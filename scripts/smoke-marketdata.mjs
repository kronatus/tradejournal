#!/usr/bin/env node
/**
 * Verify the Marketdata.app integration against the live API.
 *
 * This exists because the environment the adapter was written in could not
 * reach api.marketdata.app (blocked by egress policy), so the response shape
 * the client parses is assumed, not observed. Run this once when your key
 * arrives. It prints the RAW payload first: if the shape differs from what
 * lib/marketdata.ts expects, this is where you will see it.
 *
 *   MARKETDATA_API_TOKEN=xxx node scripts/smoke-marketdata.mjs
 *   MARKETDATA_API_TOKEN=xxx node scripts/smoke-marketdata.mjs SPY 2026-10-16 660 call
 *
 * Costs about 2 credits of your 100/day.
 */

const token = process.env.MARKETDATA_API_TOKEN;
if (!token) {
  console.error("Set MARKETDATA_API_TOKEN first.");
  process.exit(1);
}

const [underlying = "SPY", expiry, strike, type = "call"] = process.argv.slice(2);

// Default to a round-numbered strike roughly 30 days out so the script works
// with no arguments. Override with the positional args above.
function defaultExpiry() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1); // next Friday
  return d.toISOString().slice(0, 10);
}

const exp = expiry ?? defaultExpiry();
const strikeDollars = strike ? Number(strike) : 600;

const [y, m, dd] = exp.split("-");
const occStandard = `${underlying.toUpperCase()}${y.slice(-2)}${m}${dd}${
  type === "call" ? "C" : "P"
}${String(Math.round(strikeDollars * 1000)).padStart(8, "0")}`;

const BASE = "https://api.marketdata.app/v1";
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

async function show(label, url) {
  console.log(`\n=== ${label}\n${url}`);
  const res = await fetch(url, { headers });
  console.log(`HTTP ${res.status} ${res.statusText}`);
  const remaining = res.headers.get("x-api-ratelimit-remaining");
  if (remaining) console.log(`credits remaining: ${remaining}`);
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 2000));
  }
  return text;
}

console.log(`Testing contract: ${occStandard}`);

const optionRaw = await show("OPTION QUOTE", `${BASE}/options/quotes/${occStandard}/`);
await show("STOCK QUOTE", `${BASE}/stocks/quotes/${underlying.toUpperCase()}/`);

console.log("\n=== SHAPE CHECK");
try {
  const body = JSON.parse(optionRaw);
  const expected = ["s", "optionSymbol", "mid", "bid", "ask", "delta", "gamma", "theta", "vega", "iv", "updated"];
  const missing = expected.filter((k) => !(k in body));
  const arrayValued = Object.entries(body)
    .filter(([k]) => k !== "s")
    .every(([, v]) => Array.isArray(v));

  console.log(`status field  : ${body.s}`);
  console.log(`column-oriented (all non-"s" fields are arrays): ${arrayValued}`);
  console.log(`missing expected fields: ${missing.length ? missing.join(", ") : "none"}`);

  if (!arrayValued || missing.length) {
    console.log(
      "\nThe adapter in lib/marketdata.ts assumes a column-oriented payload with the\n" +
        "fields above. Something differs — paste this output back and it can be fixed\n" +
        "in one place (MarketdataOkSchema in lib/schemas.ts and firstOf() in lib/marketdata.ts)."
    );
  } else {
    console.log("\nShape matches what the adapter expects. You are good to go.");
  }
} catch (err) {
  console.log(`Could not parse option response: ${err.message}`);
}
