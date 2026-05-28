import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatKind, formatCents } from "@/lib/utils";
import { strategyNetPremiumCents } from "@/lib/calculations";
import { StatusBadge } from "@/components/status-badge";
import { Leg } from "@/lib/types";

export const revalidate = 0;

async function getStrategies() {
  const { data, error } = await supabaseServer
    .from("strategies")
    .select("*, legs(id, side, qty, entry_price_cents)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export default async function TradesPage() {
  const strategies = await getStrategies();

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Trades</h1>
          <p className="mt-1 text-sm text-text-muted">
            All strategies, newest first.
          </p>
        </div>
        <Link
          href="/trades/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          New trade
        </Link>
      </header>

      {strategies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-8 4 16 3-8h4" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold">No strategies yet</h3>
          <p className="mt-1 text-sm text-text-muted">
            Start journaling by{" "}
            <Link href="/trades/new" className="text-accent hover:underline">
              creating a trade
            </Link>{" "}
            or{" "}
            <Link href="/trades/import" className="text-accent hover:underline">
              importing a CSV
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Underlying</th>
                <th className="px-5 py-3">Strategy</th>
                <th className="px-5 py-3 text-right">Legs</th>
                <th className="px-5 py-3 text-center">Conviction</th>
                <th className="px-5 py-3 text-right">Cost/Credit</th>
                <th className="px-5 py-3 text-right">Target</th>
                <th className="px-5 py-3 text-right">Current</th>
                <th className="px-5 py-3 text-right">Opened</th>
                <th className="px-5 py-3 text-right">Status</th>
                <th className="w-10 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => {
                const closed = !!s.closed_at;
                const netPremium = s.legs?.length ? strategyNetPremiumCents(s.legs as Leg[]) : 0;
                const premiumSign = netPremium > 0 ? "Dr" : netPremium < 0 ? "Cr" : "";
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/trades/${s.id}`}
                        className="font-mono font-semibold tracking-tight text-text hover:text-accent"
                      >
                        {s.underlying}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-text-muted">{formatKind(s.strategy_kind)}</td>
                    <td className="px-5 py-3 text-right tabular text-text-muted">
                      {s.legs?.length || 0}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {s.conviction != null ? (
                        <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                          {s.conviction}/5
                        </span>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular text-text-muted">
                      {netPremium !== 0 ? `${formatCents(Math.abs(netPremium))} ${premiumSign}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular text-text-muted">
                      {s.planned_target_cents != null ? formatCents(s.planned_target_cents) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular text-text-muted">
                      {s.current_value_cents != null ? formatCents(s.current_value_cents) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular text-text-muted">
                      {new Date(s.opened_at || s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusBadge closed={closed} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/trades/${s.id}`}
                        className="text-text-subtle transition-colors hover:text-accent"
                        aria-label="View"
                      >
                        →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
