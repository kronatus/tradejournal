"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface GreekLegData {
  symbol: string;
  side: string;
  qty: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface GreeksPanelProps {
  strategyGreeks: Greeks;
  legData?: GreekLegData[];
}

export function GreeksPanel({ strategyGreeks, legData = [] }: GreeksPanelProps) {
  const chartData = [
    { name: "Delta", value: parseFloat(strategyGreeks.delta.toFixed(4)) },
    { name: "Gamma", value: parseFloat((strategyGreeks.gamma * 100).toFixed(4)) },
    { name: "Theta", value: parseFloat(strategyGreeks.theta.toFixed(4)) },
    { name: "Vega", value: parseFloat(strategyGreeks.vega.toFixed(4)) },
  ];

  return (
    <div className="space-y-4">
      {/* Greeks Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs text-text-muted">Delta (Δ)</div>
          <div className="mt-1 text-xl font-semibold">
            {strategyGreeks.delta.toFixed(3)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs text-text-muted">Gamma (Γ)</div>
          <div className="mt-1 text-xl font-semibold">
            {(strategyGreeks.gamma * 100).toFixed(3)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs text-text-muted">Theta (Θ/day)</div>
          <div className="mt-1 text-xl font-semibold">
            {strategyGreeks.theta.toFixed(3)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs text-text-muted">Vega (ν/1%)</div>
          <div className="mt-1 text-xl font-semibold">
            {strategyGreeks.vega.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Mini bar chart */}
      <div className="rounded-lg border border-border bg-surface p-3">
        <h4 className="text-xs font-semibold mb-2">Greeks Overview</h4>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="name" stroke="var(--color-text-muted)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--color-text-muted)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
              formatter={(value: number) => value.toFixed(4)}
            />
            <Bar dataKey="value" fill="var(--color-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-leg table */}
      {legData.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h4 className="text-xs font-semibold">Per-Leg Greeks</h4>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2 text-left text-text-muted">Symbol</th>
                <th className="px-4 py-2 text-left text-text-muted">Side</th>
                <th className="px-4 py-2 text-right text-text-muted">Qty</th>
                <th className="px-4 py-2 text-right text-text-muted">Δ</th>
                <th className="px-4 py-2 text-right text-text-muted">Γ</th>
                <th className="px-4 py-2 text-right text-text-muted">Θ</th>
                <th className="px-4 py-2 text-right text-text-muted">ν</th>
              </tr>
            </thead>
            <tbody>
              {legData.map((leg, idx) => (
                <tr key={idx} className="border-b border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono">{leg.symbol}</td>
                  <td className="px-4 py-2 capitalize">{leg.side}</td>
                  <td className="px-4 py-2 text-right">{leg.qty}</td>
                  <td className="px-4 py-2 text-right">{leg.delta.toFixed(3)}</td>
                  <td className="px-4 py-2 text-right">{(leg.gamma * 100).toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">{leg.theta.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">{leg.vega.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
