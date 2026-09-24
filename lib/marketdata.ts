import {
  MarketdataResponseSchema,
  MarketdataStockResponseSchema,
  QuoteSchema,
  type Quote,
} from "./schemas";
import { toStandardOcc } from "./occ";

const BASE_URL = "https://api.marketdata.app/v1";

// Free plan is 100 credits/day and an undated option request costs one credit
// PER CONTRACT returned, so we ask for exactly the contracts we hold, one at a
// time, rather than pulling a chain. A handful of concurrent requests is plenty
// and keeps us well clear of any burst limit.
const MAX_CONCURRENCY = 4;

export type QuoteFetchResult = {
  /** Keyed by the storage-format occ_symbol the caller passed in. */
  quotes: Map<string, Quote>;
  /** Storage-format occ_symbol -> why no quote came back. */
  misses: Map<string, string>;
  /** From the x-api-ratelimit-remaining header, when present. */
  creditsRemaining: number | null;
};

/** Errors that mean the whole batch is doomed, not just one contract. */
class MarketdataFatalError extends Error {}

function toIso(unixSeconds: number | undefined): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) {
    return new Date().toISOString();
  }
  return new Date(unixSeconds * 1000).toISOString();
}

function firstOf(arr: (number | null)[] | undefined): number | null {
  const v = arr?.[0];
  return v == null || !Number.isFinite(v) ? null : v;
}

/**
 * Fetch one contract. Returns a Quote, or a string explaining the miss.
 * Throws MarketdataFatalError for conditions that affect every request.
 */
async function fetchOne(
  storageOcc: string,
  token: string
): Promise<{ quote?: Quote; miss?: string; creditsRemaining: number | null }> {
  // Throws on a malformed symbol rather than sending it upstream, where it
  // would come back as an indistinguishable `no_data`.
  const standard = toStandardOcc(storageOcc);

  const res = await fetch(`${BASE_URL}/options/quotes/${standard}/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });

  const remainingHeader = res.headers.get("x-api-ratelimit-remaining");
  const creditsRemaining =
    remainingHeader != null && remainingHeader !== ""
      ? Number(remainingHeader)
      : null;

  if (res.status === 401 || res.status === 403) {
    throw new MarketdataFatalError(
      "Marketdata rejected the API token (check MARKETDATA_API_TOKEN)"
    );
  }
  if (res.status === 402) {
    throw new MarketdataFatalError(
      "Marketdata returned 402 — daily credits exhausted, or a paid-only feed was requested"
    );
  }
  if (res.status === 429) {
    throw new MarketdataFatalError("Marketdata rate limit hit (429)");
  }

  // 203 means cached/delayed data, which is exactly what the free plan serves.
  if (!res.ok && res.status !== 203) {
    return {
      miss: `HTTP ${res.status} ${res.statusText}`,
      creditsRemaining,
    };
  }

  const parsed = MarketdataResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    // Loud by design: an unrecognised payload must never be coerced into
    // plausible-looking Greeks and written to the database.
    throw new MarketdataFatalError(
      `Unexpected Marketdata response shape for ${standard}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`
    );
  }

  const body = parsed.data;
  if (body.s === "no_data") {
    return { miss: "No data for this contract", creditsRemaining };
  }
  if (body.s === "error") {
    return { miss: body.errmsg ?? "Marketdata error", creditsRemaining };
  }

  // Mark from the midpoint. Never `last`: a stale single print on an illiquid
  // strike is the main source of bogus marks and bogus implied vol.
  const bid = firstOf(body.bid);
  const ask = firstOf(body.ask);
  const price =
    firstOf(body.mid) ?? (bid != null && ask != null ? (bid + ask) / 2 : null) ?? firstOf(body.last);

  if (price == null) {
    return { miss: "Quote had no bid, ask, mid or last", creditsRemaining };
  }

  const delta = firstOf(body.delta);
  const gamma = firstOf(body.gamma);
  const theta = firstOf(body.theta);
  const vega = firstOf(body.vega);

  // Absent Greeks are recorded as such rather than silently coerced to zero —
  // a zero delta is a real and very different statement from "not supplied".
  const greeksMissing =
    delta == null || gamma == null || theta == null || vega == null;

  const quote = QuoteSchema.parse({
    price,
    delta: delta ?? 0,
    gamma: gamma ?? 0,
    theta: theta ?? 0,
    vega: vega ?? 0,
    iv: Math.max(0, firstOf(body.iv) ?? 0),
    asOf: toIso(body.updated?.[0]),
    greeksMissing,
    underlyingPrice: firstOf(body.underlyingPrice),
  });

  return { quote, creditsRemaining };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch quotes + Greeks for the given storage-format OCC symbols.
 * One credit per contract on the free plan.
 */
export async function fetchMarketdataQuotes(
  occs: string[],
  token: string
): Promise<QuoteFetchResult> {
  const quotes = new Map<string, Quote>();
  const misses = new Map<string, string>();
  let creditsRemaining: number | null = null;

  if (occs.length === 0) return { quotes, misses, creditsRemaining };

  const unique = Array.from(new Set(occs));

  const settled = await mapWithConcurrency(unique, MAX_CONCURRENCY, async (occ) => {
    try {
      return { occ, ...(await fetchOne(occ, token)) };
    } catch (err) {
      if (err instanceof MarketdataFatalError) throw err;
      return { occ, miss: (err as Error).message, creditsRemaining: null };
    }
  });

  for (const r of settled) {
    if (r.creditsRemaining != null) {
      creditsRemaining =
        creditsRemaining == null
          ? r.creditsRemaining
          : Math.min(creditsRemaining, r.creditsRemaining);
    }
    if (r.quote) quotes.set(r.occ, r.quote);
    else misses.set(r.occ, r.miss ?? "Unknown error");
  }

  return { quotes, misses, creditsRemaining };
}

/** Underlying spot price, for the sandbox. */
export async function fetchMarketdataSpot(
  symbol: string,
  token: string
): Promise<number> {
  const res = await fetch(
    `${BASE_URL}/stocks/quotes/${encodeURIComponent(symbol.toUpperCase())}/`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    }
  );

  if (!res.ok && res.status !== 203) {
    throw new Error(`Marketdata stock quote failed: HTTP ${res.status}`);
  }

  const parsed = MarketdataStockResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Unexpected Marketdata stock response for ${symbol}`);
  }
  if (parsed.data.s !== "ok") {
    throw new Error(`No spot price available for ${symbol}`);
  }

  const body = parsed.data;
  const bid = firstOf(body.bid);
  const ask = firstOf(body.ask);
  const price =
    firstOf(body.last) ?? firstOf(body.mid) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);

  if (price == null) throw new Error(`No usable spot price for ${symbol}`);
  return price;
}
