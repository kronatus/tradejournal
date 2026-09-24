import Link from "next/link";
import {
  formatCents,
  formatKind,
  formatShortDate,
  formatDayOrTime,
} from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";

export type RecentStrategyRow = {
  id: string;
  underlying: string;
  strategyKind: string;
  openValueCents: number;
  currentValueCents: number | null;
  unrealizedCents: number | null;
  realizedCents: number;
  openedAt: string;
  updatedAt: string | null;
  closed: boolean;
  openLegCount: number;
};

function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0)
    return "text-text-muted";
  return value > 0 ? "text-gain" : "text-loss";
}

/** Signed money, with an explicit + so a gain is never mistaken for a level. */
function formatSigned(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return (cents > 0 ? "+" : "") + formatCents(cents);
}

export function RecentStrategiesTable({ rows }: { rows: RecentStrategyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3">Underlying</th>
            <th className="px-4 py-3">Strategy</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Open value</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Current value</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Unrealized P&L</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Realized P&L</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Opened</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Updated</th>
            <th className="px-4 py-3 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/trades/${row.id}`}
                  className="font-mono font-semibold tracking-tight text-text hover:text-accent"
                >
                  {row.underlying}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                {formatKind(row.strategyKind)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-text-muted">
                {formatCents(row.openValueCents)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-text-muted">
                {formatCents(row.currentValueCents)}
              </td>
              <td
                className={
                  "whitespace-nowrap px-4 py-3 text-right tabular " +
                  toneClass(row.unrealizedCents)
                }
              >
                {formatSigned(row.unrealizedCents)}
              </td>
              <td
                className={
                  "whitespace-nowrap px-4 py-3 text-right tabular " +
                  toneClass(row.realizedCents)
                }
              >
                {formatSigned(row.realizedCents)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-text-muted">
                {formatShortDate(row.openedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-text-muted">
                {formatDayOrTime(row.updatedAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <StatusBadge closed={row.closed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
