"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export type RefreshTarget = {
  id: string;
  underlying: string;
  /** Open legs, which is what a refresh of this strategy costs in credits. */
  openLegCount: number;
};

type Outcome = {
  updated: number;
  failures: { underlying: string; reason: string }[];
  creditsRemaining: number | null;
};

// Marketdata bills per contract and the free plan allows 100 a day, so refreshes
// run a couple at a time rather than all at once.
const CONCURRENCY = 2;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        await fn(items[cursor++]);
      }
    })
  );
}

export function RefreshAllButton({ targets }: { targets: RefreshTarget[] }) {
  const { session } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const estimatedCredits = targets.reduce((n, t) => n + t.openLegCount, 0);
  const token = session?.access_token;

  if (targets.length === 0) return null;

  const refreshAll = async () => {
    if (!token) return;
    setBusy(true);
    setDone(0);
    setOutcome(null);

    let updated = 0;
    let creditsRemaining: number | null = null;
    const failures: { underlying: string; reason: string }[] = [];

    await runWithConcurrency(targets, CONCURRENCY, async (target) => {
      try {
        const res = await fetch(`/api/quotes?strategyId=${target.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `API error: ${res.status}`);
        if (body.persistError) throw new Error(body.persistError);

        const legError = body.perLeg?.find(
          (l: { error?: string }) => l.error
        )?.error;
        if (legError) failures.push({ underlying: target.underlying, reason: legError });
        else updated += 1;

        if (typeof body.creditsRemaining === "number") {
          creditsRemaining =
            creditsRemaining === null
              ? body.creditsRemaining
              : Math.min(creditsRemaining, body.creditsRemaining);
        }
      } catch (err) {
        failures.push({ underlying: target.underlying, reason: (err as Error).message });
      } finally {
        setDone((n) => n + 1);
      }
    });

    setOutcome({ updated, failures, creditsRemaining });
    setBusy(false);
    // Re-run the server component so the table shows the values just written.
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
      {outcome && !busy && (
        <span
          className={
            outcome.failures.length > 0 ? "text-loss" : "text-text-muted"
          }
        >
          {outcome.updated} updated
          {outcome.failures.length > 0 &&
            `, ${outcome.failures.length} failed: ${outcome.failures[0].underlying} — ${outcome.failures[0].reason}`}
          {outcome.creditsRemaining !== null &&
            ` · ${outcome.creditsRemaining} credits left`}
        </span>
      )}
      <button
        onClick={refreshAll}
        disabled={busy || !token}
        title={`Refreshes ${targets.length} open ${
          targets.length === 1 ? "position" : "positions"
        }, costing about ${estimatedCredits} of today's API credits`}
        className="rounded-md border border-border px-2.5 py-1 font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
      >
        {busy
          ? `Refreshing ${done}/${targets.length}…`
          : `Refresh all · ~${estimatedCredits} credits`}
      </button>
    </div>
  );
}
