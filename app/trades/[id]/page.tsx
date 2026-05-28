import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatCents, formatKind } from "@/lib/utils";
import { strategyRealizedPnLCents } from "@/lib/calculations";
import { Leg, Strategy } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { LiveDataPanel } from "@/components/live-data-panel";
import { StrategyEditor } from "@/components/strategy-detail/strategy-editor";
import { LegsTable } from "@/components/strategy-detail/legs-table";
import { CloseStrategyButton } from "@/components/strategy-detail/close-strategy-button";
import { DeleteStrategyButton } from "@/components/strategy-detail/delete-strategy-button";

export const revalidate = 0;

async function getStrategy(id: string): Promise<Strategy & { legs: Leg[] }> {
  const { data, error } = await supabaseServer
    .from("strategies")
    .select("*, legs(*)")
    .eq("id", id)
    .single();

  if (error) throw new Error(`Failed to fetch strategy: ${error.message}`);
  return data;
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const strategy = await getStrategy(id);

  const pnlCents = strategy.legs.length > 0
    ? strategyRealizedPnLCents(strategy, strategy.legs)
    : 0;

  const closed = !!strategy.closed_at;
  const pnlTone = pnlCents > 0 ? "gain" : pnlCents < 0 ? "loss" : "neutral";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/trades"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
        >
          ← Back to trades
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-3xl font-semibold tracking-tight">
              {strategy.underlying}
            </h1>
            <StatusBadge closed={closed} />
          </div>
          <div className="text-sm text-text-muted">
            {formatKind(strategy.strategy_kind)} · Opened{" "}
            {new Date(strategy.opened_at || strategy.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <CloseStrategyButton strategyId={strategy.id} closed={closed} legs={strategy.legs || []} />
          <DeleteStrategyButton strategyId={strategy.id} />
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Metrics</h3>
          {!closed && (
            <span className="text-xs text-text-muted">
              Includes live market data when refreshed
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
              Realized P&L
            </div>
            <div
              className={
                "mt-2 text-2xl font-semibold tabular tracking-tight " +
                (pnlTone === "gain" ? "text-gain" : pnlTone === "loss" ? "text-loss" : "text-text")
              }
            >
              {formatCents(pnlCents)}
            </div>
          </div>

          <LiveDataPanel
            strategyId={strategy.id}
            closed={closed}
            entryDelta={strategy.entry_net_delta}
            entryTheta={strategy.entry_net_theta}
            currentDelta={strategy.current_net_delta}
            currentTheta={strategy.current_net_theta}
            currentAt={strategy.current_net_at}
            closeDelta={strategy.close_net_delta}
            closeTheta={strategy.close_net_theta}
            storedMin={strategy.min_value_cents}
            storedMax={strategy.max_value_cents}
          />
        </div>
      </section>

      <StrategyEditor strategy={strategy} />

      <LegsTable
        legs={strategy.legs || []}
        strategyClosed={closed}
        strategyId={strategy.id}
        livePerLeg={null}
      />

      <div className="text-xs text-text-subtle">
        Created {new Date(strategy.created_at).toLocaleString()}
      </div>
    </div>
  );
}
