"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildSpreadCurves, type PayoffLeg } from "@/lib/payoff";
import { parseOccSymbol } from "@/lib/occ";
import { useLiveQuotes } from "./live-quotes-context";

// Sequential ramp: furthest from expiry is faintest, expiry is strongest.
const RAMP = [
  "var(--chart-seq-1)",
  "var(--chart-seq-2)",
  "var(--chart-seq-3)",
  "var(--chart-seq-4)",
  "var(--chart-seq-5)",
];

function rampColor(index: number, count: number): string {
  if (count <= 1) return RAMP[RAMP.length - 1];
  const pos = Math.round((index / (count - 1)) * (RAMP.length - 1));
  return RAMP[pos];
}

function money(value: number): string {
  const abs = Math.abs(value);
  const body =
    abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
                : abs.toFixed(2);
  return `${value < 0 ? "-" : ""}$${body}`;
}

export type PayoffChartViewProps = {
  underlying: string;
  curves: (ReturnType<typeof buildSpreadCurves> & { modelledLegs: number }) | null;
  spotPrice: number | null;
  asOf: string | null;
  hasQuotes: boolean;
  quotedLegs: number;
};

export function StrategyPayoffChart({ underlying }: { underlying: string }) {
  const { live } = useLiveQuotes();

  const curves = useMemo(() => {
    if (!live?.underlyingPrice) return null;

    const legs: PayoffLeg[] = [];
    for (const l of live.perLeg) {
      if (l.error || !(l.iv > 0)) continue;
      try {
        const { strike, expiry, type } = parseOccSymbol(l.occ_symbol);
        legs.push({
          occ_symbol: l.occ_symbol,
          strike,
          expiry,
          optionType: type === "C" ? "call" : "put",
          side: l.side,
          qty: l.qty,
          iv: l.iv,
        });
      } catch {
        // A symbol that will not parse cannot be modelled; skip it rather than
        // drawing a curve that silently omits its contribution without saying so.
      }
    }
    if (legs.length === 0) return null;

    const built = buildSpreadCurves({
      legs,
      spotPrice: live.underlyingPrice,
      maxCurves: 5,
    });
    return { ...built, modelledLegs: legs.length };
  }, [live]);

  const quotedLegs = live?.perLeg.filter((l) => !l.error).length ?? 0;

  return (
    <PayoffChartView
      underlying={underlying}
      curves={curves}
      spotPrice={live?.underlyingPrice ?? null}
      asOf={live?.asOf ?? null}
      hasQuotes={live != null}
      quotedLegs={quotedLegs}
    />
  );
}

export function PayoffChartView({
  underlying,
  curves,
  spotPrice,
  asOf,
  hasQuotes,
  quotedLegs,
}: PayoffChartViewProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Value at expiry</h3>
          <p className="mt-1 text-xs text-text-muted">
            Position value across {underlying} prices, one line per day to expiry
          </p>
        </div>
        {curves && (
          <button
            onClick={() => setShowTable((v) => !v)}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            {showTable ? "Show chart" : "Show data"}
          </button>
        )}
      </div>

      {!curves ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-surface text-sm text-text-muted">
          {hasQuotes
            ? "Not enough quote data to model this position"
            : "Refresh live data to model this position"}
        </div>
      ) : showTable ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
          <table className="w-full text-left text-xs">
            <thead className="text-text-subtle">
              <tr>
                <th className="pb-2 pr-3 font-medium">{underlying}</th>
                {curves.series.map((s) => (
                  <th key={s.key} className="pb-2 pr-3 text-right font-medium">
                    {s.label}
                    {s.isExpiry ? " (exp)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curves.data
                .filter((_, i) => i % 5 === 0)
                .map((row) => (
                  <tr key={row.price} className="border-t border-border">
                    <td className="py-1.5 pr-3 tabular">${row.price.toFixed(0)}</td>
                    {curves.series.map((s) => (
                      <td key={s.key} className="py-1.5 pr-3 text-right tabular">
                        {money(row[s.key])}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ResponsiveContainer width="100%" height={380}>
            <LineChart
              data={curves.data}
              margin={{ top: 24, right: 28, left: 8, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="price"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={money}
                label={{
                  value: "Position value",
                  angle: -90,
                  position: "insideLeft",
                  style: { fill: "var(--color-text-muted)", fontSize: 11 },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--color-text)" }}
                itemStyle={{ color: "var(--color-text-muted)" }}
                cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
                labelFormatter={(v: number) => `${underlying} $${v.toFixed(2)}`}
                formatter={(value: number, name: string) => [money(value), name]}
              />
              <Legend
                wrapperStyle={{
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  paddingTop: 8,
                }}
              />
              <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeOpacity={0.5} />
              {spotPrice != null && (
                <ReferenceLine
                  x={spotPrice}
                  stroke="var(--color-text)"
                  strokeOpacity={0.55}
                  label={{
                    value: "Current",
                    position: "insideTopRight",
                    fill: "var(--color-text-muted)",
                    fontSize: 11,
                  }}
                />
              )}
              {curves.series.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.isExpiry ? `${s.label} (expiry)` : s.label}
                  stroke={rampColor(i, curves.series.length)}
                  strokeWidth={s.isExpiry ? 2.5 : 2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {curves && (
        <p className="text-xs text-text-subtle">
          Black-Scholes from each leg&apos;s live implied volatility, marked{" "}
          {asOf ? new Date(asOf).toLocaleString() : "at last refresh"}.
          Negative values mean the position costs money to close, as a credit
          spread does.
          {curves.modelledLegs < quotedLegs &&
            ` ${quotedLegs - curves.modelledLegs} leg(s) omitted for want of an implied volatility.`}
        </p>
      )}
    </section>
  );
}
