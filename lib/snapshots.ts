import { fetchTradierQuotes } from "@/lib/quotes";
import type { Leg } from "@/lib/types";

export type GreekSnapshot = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type LegQuoteResult = {
  occ_symbol: string;
  price_cents: number;
  greeks: GreekSnapshot;
  error?: string;
};

export type SnapshotComputation = {
  netGreeks: GreekSnapshot;
  currentValueCents: number;
  perLeg: LegQuoteResult[];
  /** True when at least one open leg returned a valid Tradier quote. */
  hasData: boolean;
};

/**
 * Fetches live Tradier quotes for the given open legs and aggregates net Greeks
 * weighted by side (long=+1, short=-1) and qty*100 (contracts→shares).
 * Returns hasData=false when Tradier returns nothing usable so callers can skip persistence.
 */
export async function computeNetGreeksFromTradier(
  openLegs: Leg[],
  tradierToken: string
): Promise<SnapshotComputation> {
  const empty: SnapshotComputation = {
    netGreeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
    currentValueCents: 0,
    perLeg: [],
    hasData: false,
  };

  if (openLegs.length === 0) return empty;

  const occSymbols = openLegs.map((l) => l.occ_symbol);
  const quotesMap = await fetchTradierQuotes(occSymbols, tradierToken).catch(
    (err) => {
      console.error("[snapshots] Tradier batch fetch failed:", err.message);
      return new Map();
    }
  );

  const netGreeks: GreekSnapshot = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  let currentValueCents = 0;
  const perLeg: LegQuoteResult[] = [];
  let anyResolved = false;

  for (const leg of openLegs) {
    const quote = quotesMap.get(leg.occ_symbol);
    const sideMultiplier = leg.side === "long" ? 1 : -1;
    const contractMultiplier = leg.qty * 100;

    if (!quote) {
      perLeg.push({
        occ_symbol: leg.occ_symbol,
        price_cents: 0,
        greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
        error: "No quote returned",
      });
      continue;
    }

    anyResolved = true;
    const priceCents = quote.price * 100;
    currentValueCents += priceCents * contractMultiplier * sideMultiplier;
    netGreeks.delta += (quote.delta || 0) * contractMultiplier * sideMultiplier;
    netGreeks.gamma += (quote.gamma || 0) * contractMultiplier * sideMultiplier;
    netGreeks.theta += (quote.theta || 0) * contractMultiplier * sideMultiplier;
    netGreeks.vega += (quote.vega || 0) * contractMultiplier * sideMultiplier;

    perLeg.push({
      occ_symbol: leg.occ_symbol,
      price_cents: priceCents,
      greeks: {
        delta: quote.delta,
        gamma: quote.gamma,
        theta: quote.theta,
        vega: quote.vega,
      },
    });
  }

  return { netGreeks, currentValueCents, perLeg, hasData: anyResolved };
}
