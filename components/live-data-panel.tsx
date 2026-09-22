"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { formatCents } from "@/lib/utils";

type LiveQuoteResult = {
  currentValueCents: number;
  netGreeks: { delta: number; gamma: number; theta: number; vega: number };
  minValueCents: number | null;
  maxValueCents: number | null;
  fetchedAt: string;
  asOf: string | null;
  stale: boolean;
  creditsRemaining: number | null;
  perLeg: Array<{
    occ_symbol: string;
    price_cents: number;
    greeks: { delta: number; gamma: number; theta: number; vega: number };
    error?: string;
  }>;
};

interface LiveDataPanelProps {
  strategyId: string;
  closed: boolean;
  entryDelta: number | null;
  entryTheta: number | null;
  currentDelta: number | null;
  currentTheta: number | null;
  currentAt: string | null;
  closeDelta: number | null;
  closeTheta: number | null;
  storedMin: number | null;
  storedMax: number | null;
  storedCurrentValue: number | null;
}

function formatGreek(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

export function LiveDataPanel({
  strategyId,
  closed,
  entryDelta,
  entryTheta,
  currentDelta,
  currentTheta,
  currentAt,
  closeDelta,
  closeTheta,
  storedMin,
  storedMax,
  storedCurrentValue,
}: LiveDataPanelProps) {
  const { session } = useAuth();
  const [live, setLive] = useState<LiveQuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    if (!session?.access_token) {
      setError("Not authenticated — please refresh the page");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes?strategyId=${strategyId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `API error: ${res.status}`);
      }
      const result = (await res.json()) as LiveQuoteResult;
      const hasErrors = result.perLeg.some((leg) => leg.error);
      if (hasErrors) {
        const errorLeg = result.perLeg.find((leg) => leg.error);
        setError(errorLeg?.error || "Unable to fetch market data");
      }
      setLive(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Live overrides persisted current_net_* when present
  const displayCurrentDelta = live ? live.netGreeks.delta : currentDelta;
  const displayCurrentTheta = live ? live.netGreeks.theta : currentTheta;
  const displayCurrentValue = live ? live.currentValueCents : storedCurrentValue;
  const displayMin = live ? live.minValueCents : storedMin;
  const displayMax = live ? live.maxValueCents : storedMax;
  const markedAt = live ? live.asOf ?? live.fetchedAt : currentAt;
  const displayAt = markedAt ? new Date(markedAt).toLocaleString() : null;
  const isDelayed = live?.stale ?? false;

  // Secondary value: for closed strategies show "Close", otherwise "Current"
  const secondaryLabel = closed ? "Close" : "Current";
  const secondaryDelta = closed ? closeDelta : displayCurrentDelta;
  const secondaryTheta = closed ? closeTheta : displayCurrentTheta;

  return (
    <>
      {/* Delta card */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Delta
          </div>
          {!closed && (
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
            >
              {loading ? "…" : "Refresh"}
            </button>
          )}
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">Entry</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatGreek(entryDelta)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">{secondaryLabel}</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatGreek(secondaryDelta)}
            </span>
          </div>
        </div>
        {error && (
          <div className="mt-2 text-xs text-loss">
            {error.includes("market may be closed") ? "Market closed" : error}
          </div>
        )}
        {displayAt && !closed && (
          <div className="mt-1 text-xs text-text-muted">
            Marked: {displayAt}
            {isDelayed && " (delayed)"}
          </div>
        )}
        {live?.creditsRemaining != null && !closed && (
          <div className="mt-1 text-xs text-text-subtle">
            {live.creditsRemaining} API credits left today
          </div>
        )}
      </div>

      {/* Theta card */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          Theta
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">Entry</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatGreek(entryTheta)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">{secondaryLabel}</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatGreek(secondaryTheta)}
            </span>
          </div>
        </div>
      </div>

      {/* Current value card */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          Current {live ? "(live)" : "value"}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular tracking-tight">
          {displayCurrentValue !== null ? formatCents(displayCurrentValue) : "—"}
        </div>
        {displayMin !== null && displayMax !== null && (
          <div className="mt-2 text-xs text-text-muted">
            Range: {formatCents(displayMin)} – {formatCents(displayMax)}
          </div>
        )}
      </div>
    </>
  );
}
