"use client";

import { useEffect, useState } from "react";
import StrategyForm from "@/components/strategy-form";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ideaToTradePrefill, type TradePrefill } from "@/lib/strategy-ideas";
import type { StrategySet } from "@/lib/types";

/**
 * The new-trade form, prefilled from a saved options strategy idea
 * ("Log as trade" on /research). Fill prices are the idea's natural prices at
 * the time it was priced; edit them to your actual fills before saving.
 */
export function IdeaTradeForm({ setId, rank }: { setId: string; rank: number }) {
  const [state, setState] = useState<{ prefill: TradePrefill; pricedAt: string } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser
      .from("strategy_sets")
      .select("*")
      .eq("id", setId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const set = data as StrategySet | null;
        const idea = set?.ideas.find((i) => i.rank === rank);
        if (error || !set || !idea) {
          setState({ error: error?.message ?? "That strategy idea no longer exists." });
          return;
        }
        setState({ prefill: ideaToTradePrefill(idea, set.symbol), pricedAt: set.reference_at });
      });
    return () => {
      cancelled = true;
    };
  }, [setId, rank]);

  if (!state) return <div className="py-8 text-center text-sm text-text-muted">Loading idea…</div>;
  if ("error" in state) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-loss">{state.error}</p>
        <StrategyForm />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
        Prefilled from a strategy idea priced at {new Date(state.pricedAt).toLocaleString()}. Replace the entry
        prices with your actual fills before saving.
      </p>
      <StrategyForm initial={state.prefill} />
    </div>
  );
}
