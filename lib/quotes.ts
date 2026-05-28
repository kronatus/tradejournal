import { QuoteSchema, type Quote } from "./schemas";

// Parse OCC symbol: O:AAPL250117C00150000
export function parseOccSymbol(occ: string) {
  const match = occ.match(
    /^O:([A-Z]{1,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/
  );
  if (!match)
    throw new Error(`Invalid OCC format: ${occ}`);

  const [, symbol, yy, mm, dd, optionType, strike] = match;
  const year = parseInt(yy, 10) + 2000;
  const strikePrice = parseInt(strike, 10) / 100;

  return {
    underlying: symbol,
    expiry: `${year}-${mm}-${dd}`,
    strike: strikePrice,
    type: optionType as "C" | "P",
  };
}

// Convert OCC symbol from our storage format to Tradier format.
// Our storage: O:SPY260529C00075500 (strike in cents: 75500 = $755.00)
// Tradier expects: SPY260529C00755000 (strike formatted as: dollars*1000 padded to 8 digits)
function toTradierSymbol(occ: string): string {
  try {
    // Parse using the existing parser
    const { underlying, expiry, strike, type } = parseOccSymbol(occ);

    // Reconstruct in Tradier format:
    // Strike in Tradier format = strike_dollars * 1000 (last 3 digits are decimals)
    const strikeTradier = Math.round(strike * 1000);
    const strikeStr = String(strikeTradier).padStart(8, "0");

    // Format: YYMMDD from expiry (YYYY-MM-DD)
    const [year, month, day] = expiry.split("-");
    const yy = year.slice(-2);
    const optionChar = type === "C" ? "C" : "P";

    const result = `${underlying}${yy}${month}${day}${optionChar}${strikeStr}`;
    console.log(`[toTradierSymbol] ${occ} → ${result} (strike=$${strike} → ${strikeTradier})`);
    return result;
  } catch (err) {
    console.error(`[toTradierSymbol] Error converting ${occ}:`, err);
    return occ.startsWith("O:") ? occ.slice(2) : occ;
  }
}

// Construct OCC symbol from components for Tradier API
export function buildOccSymbol(
  underlying: string,
  expiry: string, // YYYY-MM-DD format
  strikeCents: number,
  optionType: "call" | "put"
): string {
  const [year, month, day] = expiry.split("-");
  const yy = year.slice(-2);
  const optionChar = optionType === "call" ? "C" : "P";

  // Convert strike from cents to Tradier format: strike_cents * 10, padded to 8 digits
  const strikeOcc = String(strikeCents * 10).padStart(8, "0");

  return `${underlying}${yy}${month}${day}${optionChar}${strikeOcc}`;
}

// Batch-fetches quotes from Tradier API for multiple OCC symbols in a single request.
// Returns Map keyed by original occ_symbol (with O: prefix).
export async function fetchTradierQuotes(
  occs: string[],
  token: string
): Promise<Map<string, Quote>> {
  const tradierSymbols = occs.map(toTradierSymbol);
  console.log("[fetchTradierQuotes] Converting symbols:", occs.map((o, i) => `${o} → ${tradierSymbols[i]}`));

  // Build reverse lookup: tradier symbol → original occ_symbol
  // So we can return results keyed by the original symbol (which the caller uses for lookup)
  const tradierToOriginal = new Map<string, string>();
  occs.forEach((occ, i) => tradierToOriginal.set(tradierSymbols[i], occ));

  const symbols = tradierSymbols.join(",");
  const res = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${symbols}&greeks=true`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );

  if (!res.ok) {
    throw new Error(`Tradier API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const raw = data.quotes?.quote;
  if (!raw) {
    throw new Error("Tradier returned no quote data");
  }

  // Tradier returns an object for 1 symbol, array for 2+
  const quoteList = Array.isArray(raw) ? raw : [raw];

  const result = new Map<string, Quote>();
  for (const q of quoteList) {
    // Use last trade price; fallback to mid if no recent trade
    const price = q.last ?? (q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null);
    if (!price) continue;

    // Map Tradier's response symbol back to the original occ_symbol used as DB key
    const originalKey = tradierToOriginal.get(q.symbol) ?? `O:${q.symbol}`;

    const g = q.greeks ?? {};
    // Tradier's updated_at format may not pass strict Zod datetime validation,
    // so we always use a fresh ISO timestamp to be safe.
    result.set(originalKey, QuoteSchema.parse({
      price,
      delta: g.delta ?? 0,
      gamma: g.gamma ?? 0,
      theta: g.theta ?? 0,
      vega: g.vega ?? 0,
      iv: g.mid_iv ?? g.smv_vol ?? 0,
      asOf: new Date().toISOString(),
    }));

    console.log(`[fetchTradierQuotes] ${q.symbol} (orig=${originalKey}): price=${price}, delta=${g.delta ?? 0}`);
  }

  return result;
}
