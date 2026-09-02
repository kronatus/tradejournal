"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { formatCents } from "@/lib/utils";
import { Strategy } from "@/lib/types";
import { strategyCollateralCents } from "@/lib/calculations";

type EditingField = "conviction" | "thesis" | "post_mortem" | "planned_target_cents" | "collateral_cents" | "planned_stop_cents" | null;

export function StrategyEditor({ strategy }: { strategy: Strategy }) {
  const router = useRouter();
  const { session } = useAuth();
  const [editing, setEditing] = useState<EditingField>(null);
  const [drafts, setDrafts] = useState<Record<string, string | number | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (field: EditingField) => {
    if (!field || !session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      let value: unknown;
      const draft = drafts[field];

      switch (field) {
        case "conviction":
          value = draft === "" || draft === undefined || draft === null ? null : parseInt(String(draft), 10);
          break;
        case "planned_target_cents":
        case "collateral_cents":
        case "planned_stop_cents":
          value =
            draft === "" || draft === undefined || draft === null
              ? null
              : Math.round(parseFloat(String(draft)) * 100);
          break;
        case "thesis":
        case "post_mortem":
          value = draft === "" || draft === undefined || draft === null ? null : draft;
          break;
        default:
          value = draft;
      }

      const payload = { [field]: value };

      const res = await fetch(`/api/strategies/${strategy.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to update ${field}`);
      }

      setEditing(null);
      setDrafts({});
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setDrafts({});
    setError(null);
  };

  const closed = !!strategy.closed_at;

  return (
    <div className="space-y-6">
      {/* First metrics row: Conviction */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Conviction
          </div>
          {editing === "conviction" ? (
            <div className="mt-2 space-y-2">
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={drafts.conviction ?? strategy.conviction ?? ""}
                onChange={(e) =>
                  setDrafts({ ...drafts, conviction: e.target.value ? parseInt(e.target.value, 10) : "" })
                }
                disabled={saving}
              >
                <option value="">None</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave("conviction")}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && <div className="text-xs text-loss">{error}</div>}
            </div>
          ) : (
            <div
              className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight hover:text-text-subtle"
              onClick={() => {
                setEditing("conviction");
                setDrafts({ conviction: strategy.conviction ?? "" });
              }}
            >
              {strategy.conviction != null ? `${strategy.conviction}/5` : "—"}
            </div>
          )}
        </div>
      </div>

      {/* Second metrics row: Target, Collateral, Stop, Cost/Credit */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Cost/Credit
          </div>
          <div className="mt-2 text-2xl font-semibold tabular tracking-tight text-text-muted">
            {strategy.legs && strategy.legs.length > 0
              ? formatCents(
                  strategy.legs.reduce((sum, leg) => {
                    const entryDebit = leg.entry_price_cents * leg.qty * 100;
                    const side = leg.side === "long" ? 1 : -1;
                    return sum + entryDebit * side;
                  }, 0)
                )
              : "—"}
          </div>
        </div>

        {/* Target */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Target
          </div>
          {editing === "planned_target_cents" ? (
            <div className="mt-2 space-y-2">
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={
                  drafts.planned_target_cents !== undefined && drafts.planned_target_cents !== null
                    ? String(drafts.planned_target_cents)
                    : strategy.planned_target_cents
                    ? strategy.planned_target_cents / 100
                    : ""
                }
                onChange={(e) =>
                  setDrafts({ ...drafts, planned_target_cents: e.target.value })
                }
                disabled={saving}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave("planned_target_cents")}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && <div className="text-xs text-loss">{error}</div>}
            </div>
          ) : (
            <div
              className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight text-text-muted hover:text-text"
              onClick={() => {
                setEditing("planned_target_cents");
                setDrafts({
                  planned_target_cents: strategy.planned_target_cents
                    ? strategy.planned_target_cents / 100
                    : "",
                });
              }}
            >
              {strategy.planned_target_cents != null
                ? formatCents(strategy.planned_target_cents)
                : "—"}
            </div>
          )}
        </div>

        {/* Collateral */}
        {(() => {
          const legs = strategy.legs ?? [];
          const autoCalc = strategyCollateralCents(legs);
          const displayValue = strategy.collateral_cents ?? autoCalc;
          const isAuto = strategy.collateral_cents == null && autoCalc != null;

          return (
            <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-text-subtle">
                Collateral
                {isAuto && (
                  <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-normal normal-case text-text-subtle">
                    auto
                  </span>
                )}
              </div>
              {editing === "collateral_cents" ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder={autoCalc != null ? String(autoCalc / 100) : "0.00"}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={
                      drafts.collateral_cents !== undefined && drafts.collateral_cents !== null
                        ? String(drafts.collateral_cents)
                        : strategy.collateral_cents
                        ? strategy.collateral_cents / 100
                        : ""
                    }
                    onChange={(e) =>
                      setDrafts({ ...drafts, collateral_cents: e.target.value })
                    }
                    disabled={saving}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave("collateral_cents")}
                      disabled={saving}
                      className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {saving ? "…" : "Save"}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={saving}
                      className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                  {error && <div className="text-xs text-loss">{error}</div>}
                </div>
              ) : (
                <div
                  className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight text-text-muted hover:text-text"
                  onClick={() => {
                    setEditing("collateral_cents");
                    setDrafts({
                      collateral_cents: strategy.collateral_cents
                        ? strategy.collateral_cents / 100
                        : "",
                    });
                  }}
                >
                  {displayValue != null ? formatCents(displayValue) : "—"}
                </div>
              )}
            </div>
          );
        })()}

        {/* Stop */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            Stop
          </div>
          {editing === "planned_stop_cents" ? (
            <div className="mt-2 space-y-2">
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={
                  drafts.planned_stop_cents !== undefined && drafts.planned_stop_cents !== null
                    ? String(drafts.planned_stop_cents)
                    : strategy.planned_stop_cents
                    ? strategy.planned_stop_cents / 100
                    : ""
                }
                onChange={(e) =>
                  setDrafts({ ...drafts, planned_stop_cents: e.target.value })
                }
                disabled={saving}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave("planned_stop_cents")}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && <div className="text-xs text-loss">{error}</div>}
            </div>
          ) : (
            <div
              className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight text-text-muted hover:text-text"
              onClick={() => {
                setEditing("planned_stop_cents");
                setDrafts({
                  planned_stop_cents: strategy.planned_stop_cents
                    ? strategy.planned_stop_cents / 100
                    : "",
                });
              }}
            >
              {strategy.planned_stop_cents != null
                ? formatCents(strategy.planned_stop_cents)
                : "—"}
            </div>
          )}
        </div>
      </section>

      {/* Thesis section */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Thesis</h2>
        </div>
        {editing === "thesis" ? (
          <div className="space-y-3 px-5 py-4">
            <textarea
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              rows={4}
              value={drafts.thesis ?? strategy.thesis ?? ""}
              onChange={(e) => setDrafts({ ...drafts, thesis: e.target.value })}
              disabled={saving}
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleSave("thesis")}
                disabled={saving}
                className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {error && <div className="text-xs text-loss">{error}</div>}
          </div>
        ) : (
          <p
            className="cursor-pointer whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-text-muted hover:text-text"
            onClick={() => {
              setEditing("thesis");
              setDrafts({ thesis: strategy.thesis ?? "" });
            }}
          >
            {strategy.thesis || "(click to add)"}
          </p>
        )}
      </section>

      {/* Post-mortem section — only shown when closed */}
      {closed && (
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Post-Mortem</h2>
          </div>
          {editing === "post_mortem" ? (
            <div className="space-y-3 px-5 py-4">
              <textarea
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                rows={4}
                value={drafts.post_mortem ?? strategy.post_mortem ?? ""}
                onChange={(e) =>
                  setDrafts({ ...drafts, post_mortem: e.target.value })
                }
                disabled={saving}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave("post_mortem")}
                  disabled={saving}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && <div className="text-xs text-loss">{error}</div>}
            </div>
          ) : (
            <p
              className="cursor-pointer whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-text-muted hover:text-text"
              onClick={() => {
                setEditing("post_mortem");
                setDrafts({ post_mortem: strategy.post_mortem ?? "" });
              }}
            >
              {strategy.post_mortem || "(click to add)"}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
