import { QuoteSchema, type Quote } from "./schemas";
import { toStandardOcc } from "./occ";
import { fetchMarketdataQuotes, type QuoteFetchResult } from "./marketdata";

// OCC helpers live in lib/occ.ts now; re-exported so existing callers keep
// working and so there remains exactly one implementation of the conversion.
export { parseOccSymbol, toStandardOcc, toStorageOcc, buildStorageOcc } from "./occ";
export type { QuoteFetchResult } from "./marketdata";

export type QuoteProvider = "marketdata" | "tradier";

/**
 * Which provider to use. Marketdata.app wins when configured; Tradier remains
 * as a fallback so an existing deployment keeps working through the switch.
 * MARKET_DATA_PROVIDER forces one explicitly.
 */
export function resolveQuoteProvider(): {
  provider: QuoteProvider;
  token: string;
} | null {
  const forced = process.env.MARKET_DATA_PROVIDER as QuoteProvider | undefined;
  const marketdataToken = process.env.MARKETDATA_API_TOKEN;
  const tradierToken = process.env.TRADIER_API_TOKEN;

  if (forced === "marketdata") {
    return marketdataToken ? { provider: "marketdata", token: marketdataToken } : null;
  }
  if (forced === "tradier") {
    return tradierToken ? { provider: "tradier", token: tradierToken } : null;
  }
  if (marketdataToken) return { provider: "marketdata", token: marketdataToken };
  if (tradierToken) return { provider: "tradier", token: tradierToken };
  return null;
}

/** True when some provider is configured. Routes use this to skip cleanly. */
export function isQuoteProviderConfigured(): boolean {
  return resolveQuoteProvider() !== null;
}

/**
 * Fetch quotes for storage-format OCC symbols using the configured provider.
 * Throws when no provider is configured — callers should check first.
 */
export async function fetchQuotes(occs: string[]): Promise<QuoteFetchResult> {
  const resolved = resolveQuoteProvider();
  if (!resolved) {
    throw new Error(
      "No market data provider configured — set MARKETDATA_API_TOKEN (or TRADIER_API_TOKEN)"
    );
  }
  return resolved.provider === "marketdata"
    ? fetchMarketdataQuotes(occs, resolved.token)
    : fetchTradierQuotes(occs, resolved.token);
}

/**
 * Tradier batches every symbol into one request, unlike Marketdata's
 * one-credit-per-contract model. Kept as the fallback provider.
 */
export async function fetchTradierQuotes(
  occs: string[],
  token: string
): Promise<QuoteFetchResult> {
  const quotes = new Map<string, Quote>();
  const misses = new Map<string, string>();
  if (occs.length === 0) return { quotes, misses, creditsRemaining: null };

  const unique = Array.from(new Set(occs));
  const standardToStorage = new Map<string, string>();
  for (const occ of unique) {
    // Throws on malformed input rather than sending it upstream.
    standardToStorage.set(toStandardOcc(occ), occ);
  }

  const symbols = Array.from(standardToStorage.keys()).join(",");
  const res = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${symbols}&greeks=true`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );

  if (!res.ok) {
    throw new Error(`Tradier API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const raw = data.quotes?.quote;
  const quoteList = raw == null ? [] : Array.isArray(raw) ? raw : [raw];

  for (const q of quoteList) {
    const storageKey = standardToStorage.get(q.symbol);
    if (!storageKey) continue;

    const price =
      q.last ?? (q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null);
    if (price == null) {
      misses.set(storageKey, "Quote had no last, bid or ask");
      continue;
    }

    const g = q.greeks ?? {};
    const greeksMissing =
      g.delta == null || g.gamma == null || g.theta == null || g.vega == null;

    quotes.set(
      storageKey,
      QuoteSchema.parse({
        price,
        delta: g.delta ?? 0,
        gamma: g.gamma ?? 0,
        theta: g.theta ?? 0,
        vega: g.vega ?? 0,
        iv: Math.max(0, g.mid_iv ?? g.smv_vol ?? 0),
        // Tradier's greeks.updated_at does not reliably pass strict
        // z.string().datetime(); see CLAUDE.md.
        asOf: new Date().toISOString(),
        greeksMissing,
      })
    );
  }

  for (const occ of unique) {
    if (!quotes.has(occ) && !misses.has(occ)) {
      misses.set(occ, "No quote returned");
    }
  }

  return { quotes, misses, creditsRemaining: null };
}

/** Underlying spot price via the configured provider (used by the sandbox). */
export async function fetchSpot(symbol: string): Promise<number> {
  const resolved = resolveQuoteProvider();
  if (!resolved) {
    throw new Error(
      "No market data provider configured — set MARKETDATA_API_TOKEN (or TRADIER_API_TOKEN)"
    );
  }

  if (resolved.provider === "marketdata") {
    const { fetchMarketdataSpot } = await import("./marketdata");
    return fetchMarketdataSpot(symbol, resolved.token);
  }

  const res = await fetch(
    `https://api.tradier.com/v1/markets/quotes?symbols=${encodeURIComponent(symbol)}`,
    {
      headers: {
        Authorization: `Bearer ${resolved.token}`,
        Accept: "application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`Tradier spot quote failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    quotes?: { quote?: { last?: number; bid?: number; ask?: number } | { last?: number; bid?: number; ask?: number }[] };
  };
  const raw = data.quotes?.quote;
  const quote = Array.isArray(raw) ? raw[0] : raw;
  const price =
    quote?.last ??
    (quote?.bid != null && quote?.ask != null ? (quote.bid + quote.ask) / 2 : null);

  if (price == null) throw new Error(`No usable spot price for ${symbol}`);
  return price;
}
