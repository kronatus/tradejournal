"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";

export type LiveLegQuote = {
  occ_symbol: string;
  side: "long" | "short";
  qty: number;
  price_cents: number;
  delta_contribution: number;
  theta_contribution: number;
  iv: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  as_of?: string;
  greeks_missing?: boolean;
  error?: string;
};

export type LiveQuoteResult = {
  currentValueCents: number;
  netGreeks: { delta: number; gamma: number; theta: number; vega: number };
  minValueCents: number | null;
  maxValueCents: number | null;
  rawDelta: number | null;
  rawTheta: number | null;
  legCount: number;
  underlyingPrice: number | null;
  fetchedAt: string;
  asOf: string | null;
  stale: boolean;
  creditsRemaining: number | null;
  perLeg: LiveLegQuote[];
};

type LiveQuotesValue = {
  live: LiveQuoteResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const LiveQuotesContext = createContext<LiveQuotesValue | null>(null);

/**
 * Owns the one quote fetch for a strategy so the metrics cards and the payoff
 * chart share it. They sit far apart on the page, and each Marketdata request
 * costs a credit per contract, so fetching twice is not an option.
 */
export function LiveQuotesProvider({
  strategyId,
  children,
}: {
  strategyId: string;
  children: ReactNode;
}) {
  const { session } = useAuth();
  // Narrowed here rather than in the dependency array so the React Compiler can
  // see the same dependency the callback actually reads.
  const accessToken = session?.access_token;
  const [live, setLive] = useState<LiveQuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setError("Not authenticated — please refresh the page");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes?strategyId=${strategyId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `API error: ${res.status}`);
      }
      const result = (await res.json()) as LiveQuoteResult;
      const failed = result.perLeg.find((l) => l.error);
      if (failed) setError(failed.error ?? "Unable to fetch market data");
      setLive(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, strategyId]);

  const value = useMemo(
    () => ({ live, loading, error, refresh }),
    [live, loading, error, refresh]
  );

  return (
    <LiveQuotesContext.Provider value={value}>
      {children}
    </LiveQuotesContext.Provider>
  );
}

export function useLiveQuotes(): LiveQuotesValue {
  const ctx = useContext(LiveQuotesContext);
  if (!ctx) {
    throw new Error("useLiveQuotes must be used inside a LiveQuotesProvider");
  }
  return ctx;
}
