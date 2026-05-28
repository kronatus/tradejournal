"use client";

import { useState } from "react";
import { StrategyInput, LegInput } from "@/lib/schemas";
import { STRATEGY_KINDS } from "@/lib/types";
import { formatKind } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

type LegRow = LegInput & {
  side: "buy" | "sell";
  ticker: string;
  optionType: "C" | "P";
  strike: string;
  expiry: string;
};

const emptyLeg = (): LegRow => ({
  occ_symbol: "",
  side: "buy",
  action: "open",
  quantity: 1,
  entry_price_cents: 0,
  exit_price_cents: null,
  stop_loss_cents: null,
  target_cents: null,
  ticker: "",
  optionType: "C",
  strike: "",
  expiry: "",
});

const inputCls =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-subtle transition-colors focus:border-accent";
const cellInputCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs placeholder:text-text-subtle transition-colors focus:border-accent";

export default function StrategyForm() {
  const { session } = useAuth();
  const [underlying, setUnderlying] = useState("");
  const [strategyKind, setStrategyKind] = useState<string>("");
  const [conviction, setConviction] = useState(5);
  const [notes, setNotes] = useState("");
  const [openedAt, setOpenedAt] = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  });
  const [legs, setLegs] = useState<LegRow[]>([emptyLeg()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddLeg = () => setLegs([...legs, emptyLeg()]);

  const buildOccSymbol = (
    ticker: string,
    optionType: "C" | "P",
    strike: string,
    expiry: string
  ): string => {
    if (!ticker || !strike || !expiry) return "";
    const strikeCents = Math.round(parseFloat(strike) * 100);
    const strikeStr = strikeCents.toString().padStart(8, "0");
    const [year, month, day] = expiry.split("-");
    const yy = year.slice(-2);
    return `O:${ticker.toUpperCase()}${yy}${month}${day}${optionType}${strikeStr}`;
  };

  const handleRemoveLeg = (index: number) => {
    setLegs(legs.filter((_, i) => i !== index));
  };

  const handleLegChange = (
    index: number,
    field: keyof LegRow,
    value: unknown
  ) => {
    const newLegs = [...legs];
    newLegs[index] = { ...newLegs[index], [field]: value };
    setLegs(newLegs);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const legsWithOcc = legs.map((leg) => ({
        occ_symbol: buildOccSymbol(leg.ticker, leg.optionType, leg.strike, leg.expiry),
        side: leg.side,
        action: leg.action,
        quantity: leg.quantity,
        entry_price_cents: leg.entry_price_cents,
        exit_price_cents: leg.exit_price_cents,
        stop_loss_cents: leg.stop_loss_cents,
        target_cents: leg.target_cents,
      }));

      const payload: StrategyInput = {
        underlying,
        strategy_kind: strategyKind as typeof STRATEGY_KINDS[number],
        conviction_rating: conviction,
        notes,
        opened_at: new Date(openedAt).toISOString(),
        legs: legsWithOcc,
      };

      const res = await fetch("/api/trades", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create trade");
      }

      window.location.href = "/trades";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-loss/40 bg-loss-soft px-4 py-3 text-sm text-loss">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Basics</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Underlying
            </label>
            <input
              type="text"
              value={underlying}
              onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className={inputCls + " font-mono"}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Strategy
            </label>
            <select
              value={strategyKind}
              onChange={(e) => setStrategyKind(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select strategy…</option>
              {STRATEGY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {formatKind(kind)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Opened at
            </label>
            <input
              type="datetime-local"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
              className={inputCls}
              required
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Conviction & notes</h2>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Conviction
              </label>
              <span className="text-sm font-semibold tabular">{conviction}/5</span>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              value={conviction}
              onChange={(e) => setConviction(parseInt(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Thesis, setup, mistake tags…"
              className={inputCls + " h-24 resize-y"}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Legs</h2>
          <button
            type="button"
            onClick={handleAddLeg}
            className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            + Add leg
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-[10px] font-medium uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2.5">Ticker</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 text-right">Strike</th>
                <th className="px-3 py-2.5">Expiry</th>
                <th className="px-3 py-2.5">Side</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Entry ($)</th>
                <th className="px-3 py-2.5 text-right">Exit ($)</th>
                <th className="px-3 py-2.5 text-right">Stop ($)</th>
                <th className="px-3 py-2.5 text-right">Target ($)</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={leg.ticker}
                      onChange={(e) => handleLegChange(idx, "ticker", e.target.value.toUpperCase())}
                      placeholder="AAPL"
                      className={cellInputCls + " font-mono"}
                      maxLength={5}
                      required
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={leg.optionType}
                      onChange={(e) => handleLegChange(idx, "optionType", e.target.value as "C" | "P")}
                      className={cellInputCls}
                    >
                      <option value="C">Call</option>
                      <option value="P">Put</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.strike}
                      onChange={(e) => handleLegChange(idx, "strike", e.target.value)}
                      placeholder="150.00"
                      step="0.01"
                      className={cellInputCls + " text-right tabular"}
                      required
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={leg.expiry}
                      onChange={(e) => handleLegChange(idx, "expiry", e.target.value)}
                      className={cellInputCls}
                      required
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={leg.side}
                      onChange={(e) => handleLegChange(idx, "side", e.target.value as "buy" | "sell")}
                      className={cellInputCls}
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={leg.action}
                      onChange={(e) => handleLegChange(idx, "action", e.target.value as "open" | "close")}
                      className={cellInputCls}
                    >
                      <option value="open">Open</option>
                      <option value="close">Close</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.quantity}
                      onChange={(e) => handleLegChange(idx, "quantity", parseInt(e.target.value) || 1)}
                      className={cellInputCls + " text-right tabular"}
                      min="1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.entry_price_cents / 100}
                      onChange={(e) =>
                        handleLegChange(idx, "entry_price_cents", Math.round(parseFloat(e.target.value) * 100))
                      }
                      step="0.01"
                      className={cellInputCls + " text-right tabular"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.exit_price_cents ? leg.exit_price_cents / 100 : ""}
                      onChange={(e) =>
                        handleLegChange(
                          idx,
                          "exit_price_cents",
                          e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null
                        )
                      }
                      step="0.01"
                      className={cellInputCls + " text-right tabular"}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.stop_loss_cents ? leg.stop_loss_cents / 100 : ""}
                      onChange={(e) =>
                        handleLegChange(
                          idx,
                          "stop_loss_cents",
                          e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null
                        )
                      }
                      step="0.01"
                      className={cellInputCls + " text-right tabular"}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={leg.target_cents ? leg.target_cents / 100 : ""}
                      onChange={(e) =>
                        handleLegChange(
                          idx,
                          "target_cents",
                          e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null
                        )
                      }
                      step="0.01"
                      className={cellInputCls + " text-right tabular"}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveLeg(idx)}
                      className="text-text-subtle transition-colors hover:text-loss disabled:opacity-30"
                      disabled={legs.length === 1}
                      aria-label="Remove leg"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create trade"}
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-md border border-border bg-surface px-5 py-2 text-sm font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
