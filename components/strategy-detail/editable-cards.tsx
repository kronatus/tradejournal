"use client";

import { useState } from "react";
import { formatCents } from "@/lib/utils";
import { Strategy } from "@/lib/types";
import { strategyCollateralCents } from "@/lib/calculations";
import { useStrategyPatch } from "./use-strategy-patch";

const CARD = "rounded-lg border border-border bg-surface p-4 shadow-sm";
const LABEL = "text-xs font-medium uppercase tracking-wide text-text-subtle";
const BUTTON =
  "flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50";

function SaveCancel({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button onClick={onSave} disabled={saving} className={BUTTON}>
        {saving ? "…" : "Save"}
      </button>
      <button onClick={onCancel} disabled={saving} className={BUTTON}>
        Cancel
      </button>
    </div>
  );
}

/** Inline-editable 1–5 conviction, rendered inside the combined summary card. */
export function ConvictionField({ strategy }: { strategy: Strategy }) {
  const { save, saving, error, clearError } = useStrategyPatch(strategy.id);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const cancel = () => {
    setDraft(null);
    clearError();
  };

  return (
    <div>
      <div className={LABEL}>Conviction</div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <select
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          >
            <option value="">None</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <SaveCancel
            saving={saving}
            onCancel={cancel}
            onSave={async () => {
              const ok = await save({ conviction: draft ? parseInt(draft, 10) : null });
              if (ok) setDraft(null);
            }}
          />
          {error && <div className="text-xs text-loss">{error}</div>}
        </div>
      ) : (
        <div
          className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight hover:text-text-subtle"
          onClick={() => setDraft(String(strategy.conviction ?? ""))}
        >
          {strategy.conviction != null ? `${strategy.conviction}/5` : "—"}
        </div>
      )}
    </div>
  );
}

type MoneyField = "planned_target_cents" | "collateral_cents" | "planned_stop_cents";

function MoneyCard({
  strategyId,
  field,
  label,
  storedCents,
  displayCents,
  placeholderCents,
  badge,
}: {
  strategyId: string;
  field: MoneyField;
  label: string;
  storedCents: number | null;
  /** What to show when not editing; defaults to the stored value. */
  displayCents?: number | null;
  placeholderCents?: number | null;
  badge?: string;
}) {
  const { save, saving, error, clearError } = useStrategyPatch(strategyId);
  const [draft, setDraft] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const editing = draft !== null;
  const shown = displayCents !== undefined ? displayCents : storedCents;

  const cancel = () => {
    setDraft(null);
    setLocalError(null);
    clearError();
  };

  const submit = async () => {
    const trimmed = (draft ?? "").trim();
    let value: number | null = null;
    if (trimmed !== "") {
      const dollars = parseFloat(trimmed);
      if (!Number.isFinite(dollars)) {
        setLocalError("Enter a valid amount");
        return;
      }
      value = Math.round(dollars * 100);
    }
    setLocalError(null);
    const ok = await save({ [field]: value });
    if (ok) setDraft(null);
  };

  return (
    <div className={CARD}>
      <div className={`flex items-center gap-1 ${LABEL}`}>
        {label}
        {badge && (
          <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-normal normal-case text-text-subtle">
            {badge}
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            type="number"
            step="0.01"
            placeholder={placeholderCents != null ? String(placeholderCents / 100) : "0.00"}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <SaveCancel saving={saving} onSave={submit} onCancel={cancel} />
          {(localError || error) && (
            <div className="text-xs text-loss">{localError ?? error}</div>
          )}
        </div>
      ) : (
        <div
          className="mt-2 cursor-pointer text-2xl font-semibold tabular tracking-tight text-text-muted hover:text-text"
          onClick={() => setDraft(storedCents ? String(storedCents / 100) : "")}
        >
          {shown != null ? formatCents(shown) : "—"}
        </div>
      )}
    </div>
  );
}

/** Cost/Credit, Target, Collateral and Stop — one row, so they sit above the tables. */
export function PlanCards({ strategy }: { strategy: Strategy }) {
  const legs = strategy.legs ?? [];
  const autoCollateral = strategyCollateralCents(legs);
  const costCredit = legs.reduce(
    (sum, leg) =>
      sum + leg.entry_price_cents * leg.qty * 100 * (leg.side === "long" ? 1 : -1),
    0
  );

  return (
    <>
      <div className={CARD}>
        <div className={LABEL}>Cost/Credit</div>
        <div className="mt-2 text-2xl font-semibold tabular tracking-tight text-text-muted">
          {legs.length > 0 ? formatCents(costCredit) : "—"}
        </div>
      </div>
      <MoneyCard
        strategyId={strategy.id}
        field="planned_target_cents"
        label="Target"
        storedCents={strategy.planned_target_cents}
      />
      <MoneyCard
        strategyId={strategy.id}
        field="collateral_cents"
        label="Collateral"
        storedCents={strategy.collateral_cents}
        displayCents={strategy.collateral_cents ?? autoCollateral}
        placeholderCents={autoCollateral}
        badge={strategy.collateral_cents == null && autoCollateral != null ? "auto" : undefined}
      />
      <MoneyCard
        strategyId={strategy.id}
        field="planned_stop_cents"
        label="Stop"
        storedCents={strategy.planned_stop_cents}
      />
    </>
  );
}
