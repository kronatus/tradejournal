import { fetchQuotes } from "@/lib/quotes";
import type { Leg } from "@/lib/types";
import type { Quote } from "@/lib/schemas";

export type GreekSnapshot = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type LegQuoteResult = {
  occ_symbol: string;
  side: "long" | "short";
  qty: number;
  price_cents: number;
  greeks: GreekSnapshot;
  /** This leg's signed share-equivalent delta: delta * qty * 100 * side.
   *  Exposed so a surprising net can be traced to the leg producing it. */
  delta_contribution: number;
  /** Provider timestamp for this mark. The free feed is delayed, so this is
   *  what the UI should show rather than the time of the request. */
  as_of?: string;
  /** Price arrived but Greeks did not; excluded from the net Greeks below. */
  greeks_missing?: boolean;
  error?: string;
};

export type SnapshotComputation = {
  netGreeks: GreekSnapshot;
  currentValueCents: number;
  perLeg: LegQuoteResult[];
  /** True when at least one open leg returned a usable quote. */
  hasData: boolean;
  /** Oldest provider timestamp across legs — the staleness of the whole set. */
  asOf: string | null;
  /** Remaining daily credits, when the provider reports them. */
  creditsRemaining: number | null;
};

const EMPTY_GREEKS: GreekSnapshot = { delta: 0, gamma: 0, theta: 0, vega: 0 };

/**
 * Fetch live quotes for the given open legs and aggregate net Greeks, weighted
 * by side (long +1, short -1) and qty*100 (contracts -> shares).
 *
 * Returns hasData=false when nothing usable came back, so callers can skip
 * persistence rather than overwrite good history with zeros.
 */
export async function computeNetGreeks(
  openLegs: Leg[]
): Promise<SnapshotComputation> {
  const empty: SnapshotComputation = {
    netGreeks: { ...EMPTY_GREEKS },
    currentValueCents: 0,
    perLeg: [],
    hasData: false,
    asOf: null,
    creditsRemaining: null,
  };

  if (openLegs.length === 0) return empty;

  let quotes = new Map<string, Quote>();
  let misses = new Map<string, string>();
  let creditsRemaining: number | null = null;

  try {
    const result = await fetchQuotes(openLegs.map((l) => l.occ_symbol));
    quotes = result.quotes;
    misses = result.misses;
    creditsRemaining = result.creditsRemaining;
  } catch (err) {
    // A whole-batch failure (bad token, exhausted credits, unrecognised
    // payload) becomes a per-leg reason so the UI can say what went wrong.
    const reason = (err as Error).message;
    console.error("[snapshots] Quote fetch failed:", reason);
    return {
      ...empty,
      perLeg: openLegs.map((leg) => ({
        occ_symbol: leg.occ_symbol,
        side: leg.side,
        qty: leg.qty,
        price_cents: 0,
        greeks: { ...EMPTY_GREEKS },
        delta_contribution: 0,
        error: reason,
      })),
    };
  }

  const netGreeks: GreekSnapshot = { ...EMPTY_GREEKS };
  let currentValueCents = 0;
  const perLeg: LegQuoteResult[] = [];
  let anyResolved = false;
  let oldestAsOf: string | null = null;

  for (const leg of openLegs) {
    const quote = quotes.get(leg.occ_symbol);
    const sideMultiplier = leg.side === "long" ? 1 : -1;
    const contractMultiplier = leg.qty * 100;

    if (!quote) {
      perLeg.push({
        occ_symbol: leg.occ_symbol,
        side: leg.side,
        qty: leg.qty,
        price_cents: 0,
        greeks: { ...EMPTY_GREEKS },
        delta_contribution: 0,
        error: misses.get(leg.occ_symbol) ?? "No quote returned",
      });
      continue;
    }

    anyResolved = true;
    const priceCents = Math.round(quote.price * 100);
    currentValueCents += priceCents * contractMultiplier * sideMultiplier;

    if (!quote.greeksMissing) {
      netGreeks.delta += quote.delta * contractMultiplier * sideMultiplier;
      netGreeks.gamma += quote.gamma * contractMultiplier * sideMultiplier;
      netGreeks.theta += quote.theta * contractMultiplier * sideMultiplier;
      netGreeks.vega += quote.vega * contractMultiplier * sideMultiplier;
    }

    if (oldestAsOf === null || quote.asOf < oldestAsOf) oldestAsOf = quote.asOf;

    perLeg.push({
      occ_symbol: leg.occ_symbol,
      side: leg.side,
      qty: leg.qty,
      price_cents: priceCents,
      delta_contribution: quote.greeksMissing
        ? 0
        : quote.delta * contractMultiplier * sideMultiplier,
      greeks: {
        delta: quote.delta,
        gamma: quote.gamma,
        theta: quote.theta,
        vega: quote.vega,
      },
      as_of: quote.asOf,
      ...(quote.greeksMissing ? { greeks_missing: true } : {}),
    });
  }

  return {
    netGreeks,
    currentValueCents,
    perLeg,
    hasData: anyResolved,
    asOf: oldestAsOf,
    creditsRemaining,
  };
}
