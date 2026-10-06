"use client";

import type { ReactNode } from "react";
import { formatCents, formatOccSymbol, formatDateTime } from "@/lib/utils";
import { useLiveQuotes } from "./strategy-detail/live-quotes-context";

interface LiveDataPanelProps {
  closed: boolean;
  entryDelta: number | null;
  entryTheta: number | null;
  entryIv: number | null;
  currentDelta: number | null;
  currentTheta: number | null;
  currentIv: number | null;
  currentAt: string | null;
  closeDelta: number | null;
  closeTheta: number | null;
  storedMin: number | null;
  storedMax: number | null;
  storedCurrentValue: number | null;
  /** Realized P&L + Conviction card, rendered above Current in the first column. */
  summary: ReactNode;
}

// Net Greeks are scaled by qty*100, so they read directly as dollars: delta is
// P/L per 1-point move in the underlying, theta is P/L per day.
function formatDollars(value: number | null): string {
  if (value === null) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

/** The plain option delta, which sits in [-1, +1] for an ordinary spread. */
/** IV is stored as a decimal (0.21) and read as a percentage. */
function formatIv(value: number | null): string {
  return value === null || !(value > 0) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatRawDelta(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

export function LiveDataPanel({
  closed,
  entryDelta,
  entryTheta,
  entryIv,
  currentDelta,
  currentTheta,
  currentIv,
  currentAt,
  closeDelta,
  closeTheta,
  storedMin,
  storedMax,
  storedCurrentValue,
  summary,
}: LiveDataPanelProps) {
  const { live, loading, error, refresh } = useLiveQuotes();

  // Live overrides persisted current_net_* when present
  const displayCurrentDelta = live ? live.netGreeks.delta : currentDelta;
  const displayCurrentTheta = live ? live.netGreeks.theta : currentTheta;
  const displayCurrentIv = live ? live.netIv : currentIv;
  const displayCurrentValue = live ? live.currentValueCents : storedCurrentValue;
  const displayMin = live ? live.minValueCents : storedMin;
  const displayMax = live ? live.maxValueCents : storedMax;
  const markedAt = live ? live.asOf ?? live.fetchedAt : currentAt;
  const displayAt = markedAt ? formatDateTime(markedAt) : null;
  const isDelayed = live?.stale ?? false;

  // Secondary value: for closed strategies show "Close", otherwise "Current"
  const secondaryLabel = closed ? "Close" : "Current";
  const secondaryDelta = closed ? closeDelta : displayCurrentDelta;
  const secondaryTheta = closed ? closeTheta : displayCurrentTheta;

  return (
    <>
      {/* Left column: Realized P&L + Conviction, with Current stacked beneath */}
      <div className="flex flex-col gap-3">
        {summary}
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
      </div>

      {/* Delta card */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Delta
          </div>
          {!closed && (
            <button
              onClick={refresh}
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
              {formatDollars(entryDelta)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">{secondaryLabel}</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatDollars(secondaryDelta)}
            </span>
          </div>
        </div>
        {live?.rawDelta != null && !closed && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-text-subtle">
                Δ per {live.legCount > 1 ? "spread" : "contract"}
              </span>
              <span className="text-sm font-medium tabular tracking-tight">
                {formatRawDelta(live.rawDelta)}
              </span>
            </div>
          </div>
        )}
        <div className="mt-2 text-xs text-text-muted">
          $ per 1-point move in the underlying
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
              {formatDollars(entryTheta)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">{secondaryLabel}</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatDollars(secondaryTheta)}
            </span>
          </div>
        </div>
        {live?.rawTheta != null && !closed && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-text-subtle">
                Θ per {live.legCount > 1 ? "spread" : "contract"}
              </span>
              <span className="text-sm font-medium tabular tracking-tight">
                {live.rawTheta.toFixed(4)}
              </span>
            </div>
          </div>
        )}
        <div className="mt-2 text-xs text-text-muted">$ per day</div>
      </div>


      {/* IV card */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          IV
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-text-subtle">Entry</span>
            <span className="text-lg font-semibold tabular tracking-tight">
              {formatIv(entryIv)}
            </span>
          </div>
          {!closed && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-text-subtle">Current</span>
              <span className="text-lg font-semibold tabular tracking-tight">
                {formatIv(displayCurrentIv)}
              </span>
            </div>
          )}
        </div>
        <div className="mt-2 text-xs text-text-muted">
          Implied volatility, weighted by each leg&apos;s vega
        </div>
      </div>
    </>
  );
}

/**
 * Per-leg breakdown. Lives below Thesis, outside the metrics grid, so loading it
 * never moves a card. Open strategies reserve the slot before the first refresh.
 */
export function PerLegDetail({ closed }: { closed: boolean }) {
  const { live } = useLiveQuotes();

  if (!live || live.perLeg.length === 0) {
    if (closed) return null;
    return (
      <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          Per-leg detail
        </div>
        <div className="mt-3 text-xs text-text-muted">
          Refresh the metrics above to load per-leg marks and Greeks.
        </div>
      </div>
    );
  }

  return (
              <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Per-leg detail
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-text-subtle">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Contract</th>
                  <th className="pb-2 pr-3 font-medium">Side</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                  <th className="pb-2 pr-3 text-right font-medium">Mark</th>
                  <th className="pb-2 pr-3 text-right font-medium">IV</th>
                  <th className="pb-2 pr-3 text-right font-medium">Delta</th>
                  <th className="pb-2 pr-3 text-right font-medium">$ / point</th>
                  <th className="pb-2 pr-3 text-right font-medium">Theta</th>
                  <th className="pb-2 text-right font-medium">$ / day</th>
                </tr>
              </thead>
              <tbody>
                {live.perLeg.map((l) => (
                  <tr key={l.occ_symbol} className="border-t border-border">
                    <td className="py-2 pr-3">{formatOccSymbol(l.occ_symbol)}</td>
                    <td className="py-2 pr-3 capitalize text-text-muted">{l.side}</td>
                    <td className="py-2 pr-3 text-right tabular">{l.qty}</td>
                    <td className="py-2 pr-3 text-right tabular">
                      {l.error ? "—" : formatCents(l.price_cents)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular">
                      {l.error ? "—" : formatIv(l.iv)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular">
                      {l.error || l.greeks_missing ? "—" : l.greeks.delta.toFixed(4)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular">
                      {l.error || l.greeks_missing
                        ? "—"
                        : formatDollars(l.delta_contribution)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular">
                      {l.error || l.greeks_missing ? "—" : l.greeks.theta.toFixed(4)}
                    </td>
                    <td className="py-2 text-right tabular">
                      {l.error || l.greeks_missing
                        ? "—"
                        : formatDollars(l.theta_contribution)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 pr-3" colSpan={6}>
                    Net
                  </td>
                  <td className="py-2 pr-3 text-right tabular">
                    {formatDollars(live.netGreeks.delta)}
                  </td>
                  <td className="py-2 pr-3" />
                  <td className="py-2 text-right tabular">
                    {formatDollars(live.netGreeks.theta)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {live.perLeg.some((l) => l.error || l.greeks_missing) && (
            <div className="mt-3 space-y-1 text-xs text-loss">
              {live.perLeg
                .filter((l) => l.error || l.greeks_missing)
                .map((l) => (
                  <div key={l.occ_symbol}>
                    {formatOccSymbol(l.occ_symbol)}:{" "}
                    {l.error ?? "Greeks not supplied — excluded from the net"}
                  </div>
                ))}
              <div className="text-text-muted">
                A leg missing here leaves its opposite unopposed, which inflates
                the net Greeks above.
              </div>
            </div>
          )}
        </div>
  );
}
