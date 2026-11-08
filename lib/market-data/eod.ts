/**
 * End-of-day bars for the whole US market in one request.
 *
 * Provider: Massive (formerly Polygon.io) — the free "Stocks Basic" plan
 * includes the Grouped Daily endpoint, which returns OHLCV + VWAP for every US
 * ticker for one session (consolidated volume). Free plan limit: 5 calls/min,
 * 2 years of history, end-of-day only. api.polygon.io accepts the same keys.
 *
 * This is the only file that knows the provider. Swap it (e.g. for Alpaca) and
 * nothing else changes. Server-side only: the key never reaches the client.
 */
import { MassiveErrorSchema, MassiveGroupedDailySchema } from "@/lib/schemas";
import type { MarketBar } from "@/lib/types";

export const MASSIVE_BASE_URL = "https://api.massive.com";

export type GroupedDailyResult =
  | { status: "ok"; date: string; bars: MarketBar[] }
  /** Weekend, holiday, or the session is not published yet. */
  | { status: "empty"; date: string };

export class EodRateLimitError extends Error {
  constructor() {
    super("Market data provider rate limit reached (free plan: 5 calls/minute)");
    this.name = "EodRateLimitError";
  }
}

export function eodApiKey(): string | null {
  return process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || null;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

export async function fetchGroupedDaily(
  date: string,
  opts: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }
): Promise<GroupedDailyResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date ${date}`);
  const url =
    `${opts.baseUrl ?? MASSIVE_BASE_URL}/v2/aggs/grouped/locale/us/market/stocks/${date}` +
    `?adjusted=true&apiKey=${encodeURIComponent(opts.apiKey)}`;
  const res = await (opts.fetchImpl ?? fetch)(url, { cache: "no-store" });

  if (res.status === 429) throw new EodRateLimitError();
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = MassiveErrorSchema.safeParse(body);
    const msg = err.success ? err.data.error ?? err.data.message ?? err.data.status : null;
    throw new Error(`Market data provider HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
  }

  const parsed = MassiveGroupedDailySchema.safeParse(body);
  if (!parsed.success) {
    // An unrecognised shape is an error, never coerced into bars.
    throw new Error(`Unexpected grouped-daily payload: ${parsed.error.issues[0]?.message}`);
  }
  const rows = parsed.data.results ?? [];
  if (parsed.data.resultsCount === 0 || rows.length === 0) return { status: "empty", date };

  const bars: MarketBar[] = [];
  for (const r of rows) {
    if (!(r.o > 0 && r.h > 0 && r.l > 0 && r.c > 0)) continue;
    bars.push({
      date,
      symbol: r.T,
      open_cents: toCents(r.o),
      high_cents: toCents(r.h),
      low_cents: toCents(r.l),
      close_cents: toCents(r.c),
      vwap_cents: r.vw !== undefined && r.vw > 0 ? toCents(r.vw) : null,
      volume: Math.round(r.v),
    });
  }
  return { status: "ok", date, bars };
}
