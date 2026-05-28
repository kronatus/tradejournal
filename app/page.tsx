import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatCents, formatKind } from "@/lib/utils";
import {
  totalRealizedPnLCents,
  winRate,
  avgWinCents,
  avgLossCents,
  equityCurve,
  maxDrawdownCents,
  avgHoldingPeriodDays,
  strategyRealizedPnLCents,
} from "@/lib/calculations";
import { EquityChart } from "@/components/equity-chart";
import { StatusBadge } from "@/components/status-badge";
import { ProtectedRoute } from "@/components/protected-route";
import { Strategy, Leg } from "@/lib/types";

export const revalidate = 0;

async function getDashboardData() {
  const { data, error } = await supabaseServer
    .from("strategies")
    .select("*, legs(*)")
    .order("closed_at", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return (data || []).map((s) => ({ strategy: s as Strategy, legs: (s.legs ?? []) as Leg[] }));
}

async function DashboardContent() {
  const rows = await getDashboardData();

  const curve = equityCurve(rows);
  const totalPnL = totalRealizedPnLCents(rows);
  const wr = winRate(rows);
  const avgWin = avgWinCents(rows);
  const avgLoss = avgLossCents(rows);
  const maxDD = maxDrawdownCents(curve);
  const avgHold = avgHoldingPeriodDays(rows);

  const metrics = [
    {
      label: "Total P&L",
      value: formatCents(totalPnL),
      hint: "All-time realized",
      tone: totalPnL > 0 ? "gain" : totalPnL < 0 ? "loss" : "neutral",
    },
    {
      label: "Win Rate",
      value: `${(wr * 100).toFixed(1)}%`,
      hint: "Closed strategies",
      tone: "neutral",
    },
    {
      label: "Avg Win",
      value: formatCents(avgWin),
      hint: "Per winning trade",
      tone: avgWin > 0 ? "gain" : "neutral",
    },
    {
      label: "Avg Loss",
      value: formatCents(Math.abs(avgLoss)),
      hint: "Per losing trade",
      tone: avgLoss < 0 ? "loss" : "neutral",
    },
    {
      label: "Max Drawdown",
      value: formatCents(maxDD),
      hint: "Peak-to-trough",
      tone: maxDD > 0 ? "loss" : "neutral",
    },
    {
      label: "Avg Hold",
      value: `${avgHold}d`,
      hint: "Days held",
      tone: "neutral",
    },
  ];

  const recentStrategies = rows
    .reverse()
    .slice(0, 5)
    .map((row) => ({
      ...row,
      pnl: strategyRealizedPnLCents(row.strategy, row.legs),
    }));

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Performance snapshot across your closed strategies.
          </p>
        </div>
        <Link
          href="/trades/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          New trade
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-text-subtle">
              {m.label}
            </div>
            <div
              className={
                "mt-2 text-2xl font-semibold tabular tracking-tight " +
                (m.tone === "gain"
                  ? "text-gain"
                  : m.tone === "loss"
                    ? "text-loss"
                    : "text-text")
              }
            >
              {m.value}
            </div>
            <div className="mt-1 text-xs text-text-muted">{m.hint}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Equity curve</h2>
          <span className="text-xs text-text-muted">Realized P&L over time</span>
        </div>
        <div className="px-5 py-4">
          <EquityChart data={curve} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Recent strategies</h2>
          <Link href="/trades" className="text-xs text-accent hover:underline">
            View all →
          </Link>
        </div>
        {recentStrategies.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-text-muted">No strategies yet.</p>
            <p className="mt-1 text-sm text-text-muted">
              Get started by{" "}
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
          <div className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-3">Underlying</th>
                  <th className="px-5 py-3">Strategy</th>
                  <th className="px-5 py-3 text-right">Opened</th>
                  <th className="px-5 py-3 text-right">P&L</th>
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentStrategies.map((row) => {
                  const pnlTone =
                    row.pnl > 0 ? "gain" : row.pnl < 0 ? "loss" : "neutral";
                  const closed = !!row.strategy.closed_at;
                  return (
                    <tr
                      key={row.strategy.id}
                      className="border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/trades/${row.strategy.id}`}
                          className="font-mono font-semibold tracking-tight text-text hover:text-accent"
                        >
                          {row.strategy.underlying}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-text-muted">
                        {formatKind(row.strategy.strategy_kind)}
                      </td>
                      <td className="px-5 py-3 text-right tabular text-text-muted">
                        {new Date(row.strategy.opened_at).toLocaleDateString()}
                      </td>
                      <td
                        className={
                          "px-5 py-3 text-right tabular " +
                          (pnlTone === "gain"
                            ? "text-gain"
                            : pnlTone === "loss"
                              ? "text-loss"
                              : "text-text")
                        }
                      >
                        {formatCents(row.pnl)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <StatusBadge closed={closed} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
