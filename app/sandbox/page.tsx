"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { formatCents } from "@/lib/utils";
import { bsmPrice, bsmGreeks, type Greeks as BsmGreeks } from "@/lib/pricing";
import { PayoffChart, type PayoffChartData } from "@/components/sandbox/payoff-chart";
import { DecayChart, type DecayChartData } from "@/components/sandbox/decay-chart";
import { GreeksPanel, type GreekLegData } from "@/components/sandbox/greeks-panel";

interface SandboxLeg {
  id: string;
  optionType: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiry: string;
  qty: number;
  entryPrice: number;
  iv: number;
}

interface NewLegForm {
  optionType: "call" | "put";
  side: "long" | "short";
  strike: string;
  expiry: string;
  qty: string;
  entryPrice: string;
  iv: string;
}

const RISK_FREE_RATE = 0.05;

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

export default function SandboxPage() {
  const { session } = useAuth();

  const [underlying, setUnderlying] = useState("SPY");
  const [spotPrice, setSpotPrice] = useState(580);
  const [legs, setLegs] = useState<SandboxLeg[]>([]);

  const [scenarioSpot, setScenarioSpot] = useState(spotPrice);
  const [scenarioDaysOffset, setScenarioDaysOffset] = useState(0);

  const [newLeg, setNewLeg] = useState<NewLegForm>({
    optionType: "call",
    side: "long",
    strike: "",
    expiry: new Date().toISOString().split("T")[0],
    qty: "1",
    entryPrice: "",
    iv: "0.20",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddLeg = () => {
    if (!newLeg.strike || !newLeg.entryPrice || !newLeg.iv) {
      setError("Please fill in all leg fields");
      return;
    }

    const leg: SandboxLeg = {
      id: Math.random().toString(36).slice(2, 11),
      optionType: newLeg.optionType,
      side: newLeg.side,
      strike: parseFloat(newLeg.strike),
      expiry: newLeg.expiry,
      qty: parseInt(newLeg.qty, 10),
      entryPrice: parseFloat(newLeg.entryPrice),
      iv: parseFloat(newLeg.iv),
    };

    setLegs([...legs, leg]);
    setNewLeg({
      optionType: "call",
      side: "long",
      strike: "",
      expiry: new Date().toISOString().split("T")[0],
      qty: "1",
      entryPrice: "",
      iv: "0.20",
    });
    setError(null);
  };

  const handleRemoveLeg = (id: string) => {
    setLegs(legs.filter((l) => l.id !== id));
  };

  const handleFetchSpot = async () => {
    if (!underlying) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sandbox/spot?symbol=${underlying}`);
      if (!res.ok) throw new Error("Failed to fetch spot price");
      const data = (await res.json()) as { price: number };
      setSpotPrice(data.price);
      setScenarioSpot(data.price);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchLiveData = async () => {
    if (legs.length === 0) {
      setError("Add at least one leg first");
      return;
    }

    if (!session?.access_token) {
      setError("Not authenticated");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const occSymbols = legs.map((leg) => {
        const yy = leg.expiry.slice(2, 4);
        const mm = leg.expiry.slice(5, 7);
        const dd = leg.expiry.slice(8, 10);
        const type = leg.optionType === "call" ? "C" : "P";
        const strikeStr = String(Math.round(leg.strike * 100)).padStart(8, "0");
        return `${leg.optionType === "call" ? underlying : underlying.toUpperCase()}${yy}${mm}${dd}${type}${strikeStr}`;
      });

      const res = await fetch("/api/sandbox/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ symbols: occSymbols }),
      });

      if (!res.ok) throw new Error("Failed to fetch live data");

      const data = (await res.json()) as {
        perSymbol: Array<{
          occ_symbol: string;
          price_cents: number;
          iv: number;
        }>;
      };

      const updated = legs.map((leg, idx) => ({
        ...leg,
        entryPrice: data.perSymbol[idx].price_cents / 100,
        iv: data.perSymbol[idx].iv,
      }));

      setLegs(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const { payoffData, decayData, strategyGreeks, legGreeksData } = useMemo(() => {
    if (legs.length === 0) {
      return {
        payoffData: [],
        decayData: [],
        strategyGreeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
        legGreeksData: [],
      };
    }

    const maxDays = Math.max(...legs.map((l) => daysUntil(l.expiry)));

    const payoffPoints: PayoffChartData[] = [];
    const priceRange = 0.5;
    for (let i = 0; i < 60; i++) {
      const price = spotPrice * (0.75 + (i / 59) * priceRange);

      const today = legs.reduce((sum, leg) => {
        const bsm = bsmPrice({
          S: price,
          K: leg.strike,
          r: RISK_FREE_RATE,
          T: daysUntil(leg.expiry) / 365,
          sigma: leg.iv,
          type: leg.optionType,
        });
        const multiplier = leg.side === "long" ? 1 : -1;
        const entryValue = leg.entryPrice * leg.qty * 100 * multiplier;
        return sum + bsm * leg.qty * 100 * multiplier - entryValue;
      }, 0);

      const minus7d = legs.reduce((sum, leg) => {
        const daysLeft = Math.max(0, daysUntil(leg.expiry) - 7);
        const bsm = bsmPrice({
          S: price,
          K: leg.strike,
          r: RISK_FREE_RATE,
          T: daysLeft / 365,
          sigma: leg.iv,
          type: leg.optionType,
        });
        const multiplier = leg.side === "long" ? 1 : -1;
        const entryValue = leg.entryPrice * leg.qty * 100 * multiplier;
        return sum + bsm * leg.qty * 100 * multiplier - entryValue;
      }, 0);

      const minus14d = legs.reduce((sum, leg) => {
        const daysLeft = Math.max(0, daysUntil(leg.expiry) - 14);
        const bsm = bsmPrice({
          S: price,
          K: leg.strike,
          r: RISK_FREE_RATE,
          T: daysLeft / 365,
          sigma: leg.iv,
          type: leg.optionType,
        });
        const multiplier = leg.side === "long" ? 1 : -1;
        const entryValue = leg.entryPrice * leg.qty * 100 * multiplier;
        return sum + bsm * leg.qty * 100 * multiplier - entryValue;
      }, 0);

      const atExpiry = legs.reduce((sum, leg) => {
        const bsm = bsmPrice({
          S: price,
          K: leg.strike,
          r: RISK_FREE_RATE,
          T: 0,
          sigma: leg.iv,
          type: leg.optionType,
        });
        const multiplier = leg.side === "long" ? 1 : -1;
        const entryValue = leg.entryPrice * leg.qty * 100 * multiplier;
        return sum + bsm * leg.qty * 100 * multiplier - entryValue;
      }, 0);

      payoffPoints.push({
        price,
        today,
        minus7d,
        minus14d,
        atExpiry,
      });
    }

    const decayPoints: DecayChartData[] = [];
    for (let d = maxDays; d >= 0; d--) {
      const value = legs.reduce((sum, leg) => {
        const daysLeft = Math.max(0, daysUntil(leg.expiry) - (maxDays - d));
        const bsm = bsmPrice({
          S: scenarioSpot,
          K: leg.strike,
          r: RISK_FREE_RATE,
          T: daysLeft / 365,
          sigma: leg.iv,
          type: leg.optionType,
        });
        const multiplier = leg.side === "long" ? 1 : -1;
        const entryValue = leg.entryPrice * leg.qty * 100 * multiplier;
        return sum + bsm * leg.qty * 100 * multiplier - entryValue;
      }, 0);

      decayPoints.push({ daysLeft: d, value });
    }

    const computedGreeks: BsmGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    const legGreeks: GreekLegData[] = [];

    for (const leg of legs) {
      const greeks = bsmGreeks({
        S: scenarioSpot,
        K: leg.strike,
        r: RISK_FREE_RATE,
        T: daysUntil(leg.expiry) / 365,
        sigma: leg.iv,
        type: leg.optionType,
      });

      const multiplier = leg.side === "long" ? 1 : -1;
      const qty100 = leg.qty * 100;

      computedGreeks.delta += greeks.delta * multiplier * qty100;
      computedGreeks.gamma += greeks.gamma * multiplier * qty100;
      computedGreeks.theta += greeks.theta * multiplier * qty100;
      computedGreeks.vega += greeks.vega * multiplier * qty100;

      const yy = leg.expiry.slice(2, 4);
      const mm = leg.expiry.slice(5, 7);
      const dd = leg.expiry.slice(8, 10);
      const symbol = `${underlying} ${mm}/${dd}/${yy} ${leg.strike.toFixed(0)} ${leg.optionType[0].toUpperCase()}`;

      legGreeks.push({
        symbol,
        side: leg.side,
        qty: leg.qty,
        delta: greeks.delta * multiplier * qty100,
        gamma: greeks.gamma * multiplier * qty100,
        theta: greeks.theta * multiplier * qty100,
        vega: greeks.vega * multiplier * qty100,
      });
    }

    return {
      payoffData: payoffPoints,
      decayData: decayPoints,
      strategyGreeks: computedGreeks,
      legGreeksData: legGreeks,
    };
  }, [legs, spotPrice, scenarioSpot, underlying]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Strategy Sandbox</h1>
        <p className="mt-1 text-sm text-text-muted">
          Build and analyze hypothetical options strategies
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-loss/40 bg-loss-soft px-4 py-3 text-sm text-loss">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Strategy Builder */}
        <div className="lg:col-span-1 space-y-4">
          <section className="rounded-lg border border-border bg-surface shadow-sm p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-text-subtle">Underlying</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  placeholder="e.g., SPY"
                  className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono uppercase"
                  value={underlying}
                  onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
                />
                <button
                  onClick={handleFetchSpot}
                  disabled={loading}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {loading ? "..." : "Fetch"}
                </button>
              </div>
              <div className="mt-2 text-sm font-semibold">
                Spot: {formatCents(spotPrice * 100)}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <label className="text-xs font-medium text-text-subtle block mb-3">Add Leg</label>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                    value={newLeg.optionType}
                    onChange={(e) =>
                      setNewLeg({ ...newLeg, optionType: e.target.value as "call" | "put" })
                    }
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                  <select
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                    value={newLeg.side}
                    onChange={(e) =>
                      setNewLeg({ ...newLeg, side: e.target.value as "long" | "short" })
                    }
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>

                <input
                  type="number"
                  step="0.01"
                  placeholder="Strike"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={newLeg.strike}
                  onChange={(e) => setNewLeg({ ...newLeg, strike: e.target.value })}
                />

                <input
                  type="date"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={newLeg.expiry}
                  onChange={(e) => setNewLeg({ ...newLeg, expiry: e.target.value })}
                />

                <input
                  type="number"
                  placeholder="Qty"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={newLeg.qty}
                  onChange={(e) => setNewLeg({ ...newLeg, qty: e.target.value })}
                />

                <input
                  type="number"
                  step="0.01"
                  placeholder="Entry Price"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={newLeg.entryPrice}
                  onChange={(e) => setNewLeg({ ...newLeg, entryPrice: e.target.value })}
                />

                <input
                  type="number"
                  step="0.01"
                  placeholder="IV (0.20 = 20%)"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={newLeg.iv}
                  onChange={(e) => setNewLeg({ ...newLeg, iv: e.target.value })}
                />

                <button
                  onClick={handleAddLeg}
                  className="w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-text hover:bg-accent/90"
                >
                  + Add Leg
                </button>
              </div>
            </div>

            {legs.length > 0 && (
              <div className="border-t border-border pt-4">
                <label className="text-xs font-medium text-text-subtle block mb-2">Legs ({legs.length})</label>
                <div className="space-y-2">
                  {legs.map((leg) => (
                    <div
                      key={leg.id}
                      className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
                    >
                      <div className="font-mono">
                        {leg.optionType[0].toUpperCase()} {leg.strike} {leg.side[0].toUpperCase()} ×{leg.qty}
                      </div>
                      <button
                        onClick={() => handleRemoveLeg(leg.id)}
                        className="text-loss hover:font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleFetchLiveData}
                  disabled={loading}
                  className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {loading ? "Fetching..." : "Fetch Live Prices"}
                </button>
              </div>
            )}
          </section>

          {legs.length > 0 && (
            <section className="rounded-lg border border-border bg-surface shadow-sm p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-text-subtle">
                  Scenario Spot Price
                </label>
                <input
                  type="range"
                  min={spotPrice * 0.75}
                  max={spotPrice * 1.25}
                  step={spotPrice * 0.01}
                  value={scenarioSpot}
                  onChange={(e) => setScenarioSpot(parseFloat(e.target.value))}
                  className="w-full mt-2"
                />
                <div className="mt-2 text-sm font-semibold">
                  {formatCents(scenarioSpot * 100)} ({((scenarioSpot / spotPrice - 1) * 100).toFixed(1)}%)
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-text-subtle">
                  Days to Adjust
                </label>
                <input
                  type="range"
                  min={-Math.max(...legs.map((l) => daysUntil(l.expiry)))}
                  max="0"
                  value={scenarioDaysOffset}
                  onChange={(e) => setScenarioDaysOffset(parseInt(e.target.value, 10))}
                  className="w-full mt-2"
                />
                <div className="mt-2 text-sm font-semibold">
                  {scenarioDaysOffset === 0 ? "Today" : `${-scenarioDaysOffset} days ago`}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Charts and Greeks */}
        <div className="lg:col-span-2 space-y-6">
          {legs.length > 0 ? (
            <>
              <PayoffChart data={payoffData} spotPrice={spotPrice} selectedPrice={scenarioSpot} />

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-1">
                  <DecayChart data={decayData} selectedDays={scenarioDaysOffset ? -scenarioDaysOffset : undefined} />
                </div>
                <div className="lg:col-span-2">
                  <GreeksPanel strategyGreeks={strategyGreeks} legData={legGreeksData} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-8 text-center">
              <p className="text-sm text-text-muted">Add legs to see analysis charts and Greeks</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
