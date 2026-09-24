"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  formatCents,
  formatOccSymbol,
  formatSide,
  toDatetimeLocalValue,
} from "@/lib/utils";
import { legPnLCents } from "@/lib/calculations";
import { Leg } from "@/lib/types";

interface LegsTableProps {
  legs: Leg[];
  strategyClosed: boolean;
  strategyId: string;
  livePerLeg?: Array<{ occ_symbol: string; price_cents: number }> | null;
}

interface NewLegFormState {
  underlying: string;
  optionType: "call" | "put";
  expiry: string; // YYYY-MM-DD format
  strike: string; // dollar amount as string
  side: "long" | "short";
  qty: string;
  entry_price_cents: string;
  entry_at: string;
  fees_cents: string;
}

const initialNewLegForm: NewLegFormState = {
  underlying: "",
  optionType: "call",
  expiry: "",
  strike: "",
  side: "long",
  qty: "",
  entry_price_cents: "",
  entry_at: toDatetimeLocalValue(),
  fees_cents: "",
};

export function LegsTable({
  legs,
  strategyClosed,
  strategyId,
  livePerLeg,
}: LegsTableProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [expandedLegId, setExpandedLegId] = useState<string | null>(null);
  const [exitPriceDraft, setExitPriceDraft] = useState<string>("");
  const [deletingLegId, setDeletingLegId] = useState<string | null>(null);
  const [addingLeg, setAddingLeg] = useState(false);
  const [newLegForm, setNewLegForm] = useState<NewLegFormState>(
    initialNewLegForm
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCloseClick = (leg: Leg) => {
    const livePrice = livePerLeg?.find((l) => l.occ_symbol === leg.occ_symbol);
    const initialPrice = livePrice ? (livePrice.price_cents / 100).toFixed(2) : "";
    setExitPriceDraft(initialPrice);
    setExpandedLegId(leg.id);
    setError(null);
  };

  const handleCloseLeg = async (leg: Leg) => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      const exitPriceCents = exitPriceDraft === ""
        ? 0
        : Math.round(parseFloat(exitPriceDraft) * 100);

      const res = await fetch(`/api/legs/${leg.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          exit_price_cents: exitPriceCents,
          exit_at: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to close leg");
      }

      setExpandedLegId(null);
      setExitPriceDraft("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setExpandedLegId(null);
    setExitPriceDraft("");
    setError(null);
  };

  const handleDeleteLeg = async (leg: Leg) => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/legs/${leg.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete leg");
      }

      setDeletingLegId(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLeg = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      // Validate form
      if (!newLegForm.underlying.trim()) throw new Error("Underlying symbol required");
      if (!newLegForm.expiry) throw new Error("Expiration date required");
      if (!newLegForm.strike) throw new Error("Strike price required");
      if (!newLegForm.qty) throw new Error("Quantity required");
      if (!newLegForm.entry_price_cents) throw new Error("Entry price required");
      if (!newLegForm.entry_at) throw new Error("Entry date required");

      // Build OCC symbol in storage format: O:UNDERLYING + YYMMDD + C/P + STRIKECENTS
      // Example: O:SPY260529C00075500 where 75500 is cents ($755.00)
      const strikeCents = Math.round(parseFloat(newLegForm.strike) * 100);
      const [year, month, day] = newLegForm.expiry.split("-");
      const yy = year.slice(-2);
      const optionChar = newLegForm.optionType === "call" ? "C" : "P";
      const strikeStr = String(strikeCents).padStart(8, "0");
      const occSymbol = `O:${newLegForm.underlying.toUpperCase()}${yy}${month}${day}${optionChar}${strikeStr}`;

      const entryPriceCents = Math.round(
        parseFloat(newLegForm.entry_price_cents) * 100
      );
      const feesCents = newLegForm.fees_cents
        ? Math.round(parseFloat(newLegForm.fees_cents) * 100)
        : 0;

      // Convert datetime-local to ISO string
      const entryAt = new Date(newLegForm.entry_at).toISOString();

      const res = await fetch("/api/legs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          strategy_id: strategyId,
          occ_symbol: occSymbol,
          option_type: newLegForm.optionType,
          side: newLegForm.side,
          qty: parseInt(newLegForm.qty, 10),
          entry_price_cents: entryPriceCents,
          entry_at: entryAt,
          fees_cents: feesCents,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add leg");
      }

      setAddingLeg(false);
      setNewLegForm(initialNewLegForm);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">Legs</h2>
        <span className="text-xs text-text-muted">{legs?.length || 0} total</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Symbol</th>
            <th className="px-5 py-3">Side</th>
            <th className="px-5 py-3 text-right">Qty</th>
            <th className="px-5 py-3 text-right">Entry</th>
            <th className="px-5 py-3 text-right">Exit</th>
            <th className="px-5 py-3 text-right">P&L</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {[...legs]
            .sort((a, b) => {
              const aOpen = a.exit_price_cents === null;
              const bOpen = b.exit_price_cents === null;
              if (aOpen === bOpen) return 0;
              return aOpen ? -1 : 1;
            })
            .map((leg) => {
            const legPnL = leg.exit_price_cents != null ? legPnLCents(leg) : null;
            const legClosed = leg.exit_price_cents != null;
            const isExpanded = expandedLegId === leg.id;
            const isOpen = leg.exit_price_cents == null && !strategyClosed;

            return (
              <tr
                key={leg.id}
                className="border-b border-border last:border-0 hover:bg-muted/40"
              >
                <td className="px-5 py-3 font-mono text-xs">
                  {formatOccSymbol(leg.occ_symbol)}
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {formatSide(leg.side)}
                </td>
                <td className="px-5 py-3 text-right tabular">{leg.qty}</td>
                <td className="px-5 py-3 text-right tabular">
                  {formatCents(leg.entry_price_cents)}
                </td>

                {/* Exit price cell — transforms to input when expanded */}
                <td className="px-5 py-3 text-right tabular text-text-muted">
                  {isExpanded && isOpen ? (
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-sm"
                        value={exitPriceDraft}
                        onChange={(e) => setExitPriceDraft(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  ) : (
                    <>{leg.exit_price_cents != null ? formatCents(leg.exit_price_cents) : "—"}</>
                  )}
                </td>

                <td
                  className={
                    "px-5 py-3 text-right tabular " +
                    (legPnL == null
                      ? "text-text-subtle"
                      : legPnL > 0
                      ? "text-gain"
                      : legPnL < 0
                      ? "text-loss"
                      : "text-text")
                  }
                >
                  {legPnL != null ? formatCents(legPnL) : "—"}
                </td>

                <td className="px-5 py-3">
                  {legClosed && (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-text-muted">
                      Closed
                    </span>
                  )}
                </td>

                {/* Action column */}
                <td className="px-5 py-3 text-right">
                  {deletingLegId === leg.id ? (
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => handleDeleteLeg(leg)}
                        disabled={saving}
                        className="rounded border border-loss/40 bg-loss/10 px-2 py-1 text-xs font-medium text-loss hover:bg-loss/20 disabled:opacity-50"
                      >
                        {saving ? "…" : "Confirm delete"}
                      </button>
                      <button
                        onClick={() => {
                          setDeletingLegId(null);
                          setError(null);
                        }}
                        disabled={saving}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : isExpanded && isOpen ? (
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => handleCloseLeg(leg)}
                        disabled={saving}
                        className="rounded border border-gain bg-gain/10 px-2 py-1 text-xs font-medium text-gain hover:bg-gain/20 disabled:opacity-50"
                      >
                        {saving ? "…" : "Confirm"}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={saving}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-end">
                      {isOpen && (
                        <button
                          onClick={() => handleCloseClick(leg)}
                          className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted"
                        >
                          Close
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setDeletingLegId(leg.id);
                          setError(null);
                        }}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-loss hover:bg-loss/10"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!strategyClosed && (
        <div className="border-t border-border px-5 py-3">
          {addingLeg ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Add New Leg</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Underlying
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., AAPL"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono uppercase"
                    value={newLegForm.underlying}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        underlying: e.target.value.toUpperCase(),
                      })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Type
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.optionType}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        optionType: e.target.value as "call" | "put",
                      })
                    }
                    disabled={saving}
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Expiration (YYYY-MM-DD)
                  </label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.expiry}
                    onChange={(e) =>
                      setNewLegForm({ ...newLegForm, expiry: e.target.value })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Strike ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="150.00"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.strike}
                    onChange={(e) =>
                      setNewLegForm({ ...newLegForm, strike: e.target.value })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Side
                  </label>
                  <select
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.side}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        side: e.target.value as "long" | "short",
                      })
                    }
                    disabled={saving}
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="100"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.qty}
                    onChange={(e) =>
                      setNewLegForm({ ...newLegForm, qty: e.target.value })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Entry Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="100.00"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.entry_price_cents}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        entry_price_cents: e.target.value,
                      })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Entry Date/Time
                  </label>
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.entry_at}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        entry_at: e.target.value,
                      })
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-subtle">
                    Fees ($) <span className="text-text-subtle">optional</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={newLegForm.fees_cents}
                    onChange={(e) =>
                      setNewLegForm({
                        ...newLegForm,
                        fees_cents: e.target.value,
                      })
                    }
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddLeg}
                  disabled={saving}
                  className="rounded-md border border-gain bg-gain/10 px-4 py-2 text-sm font-medium text-gain hover:bg-gain/20 disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add Leg"}
                </button>
                <button
                  onClick={() => {
                    setAddingLeg(false);
                    setNewLegForm(initialNewLegForm);
                    setError(null);
                  }}
                  disabled={saving}
                  className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <div className="rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-xs text-loss">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setAddingLeg(true)}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              + Add Leg
            </button>
          )}
        </div>
      )}

      {error && !addingLeg && (
        <div className="border-t border-border px-5 py-3">
          <div className="rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-xs text-loss">
            {error}
          </div>
        </div>
      )}
    </section>
  );
}
