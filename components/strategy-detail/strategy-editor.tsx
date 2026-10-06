"use client";

import { useState } from "react";
import { Strategy } from "@/lib/types";
import { useStrategyPatch } from "./use-strategy-patch";

type TextField = "thesis" | "post_mortem";

function TextSection({
  strategyId,
  field,
  title,
  value,
}: {
  strategyId: string;
  field: TextField;
  title: string;
  value: string | null;
}) {
  const { save, saving, error, clearError } = useStrategyPatch(strategyId);
  const [draft, setDraft] = useState<string | null>(null);

  const cancel = () => {
    setDraft(null);
    clearError();
  };

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {draft !== null ? (
        <div className="space-y-3 px-5 py-4">
          <textarea
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
          />
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const ok = await save({ [field]: draft === "" ? null : draft });
                if (ok) setDraft(null);
              }}
              disabled={saving}
              className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={cancel}
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
          onClick={() => setDraft(value ?? "")}
        >
          {value || "(click to add)"}
        </p>
      )}
    </section>
  );
}

/** Thesis, plus the post-mortem once the strategy is closed. */
export function StrategyEditor({ strategy }: { strategy: Strategy }) {
  return (
    <div className="space-y-6">
      <TextSection strategyId={strategy.id} field="thesis" title="Thesis" value={strategy.thesis} />
      {strategy.closed_at && (
        <TextSection
          strategyId={strategy.id}
          field="post_mortem"
          title="Post-Mortem"
          value={strategy.post_mortem}
        />
      )}
    </div>
  );
}
