"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export interface DecayChartData {
  daysLeft: number;
  value: number;
}

export interface DecayChartProps {
  data: DecayChartData[];
  selectedDays?: number;
}

export function DecayChart({
  data,
  selectedDays,
}: DecayChartProps) {
  return (
    <div className="w-full h-full min-h-80 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Theta Decay</h3>
        <p className="text-xs text-text-muted mt-1">
          Strategy value at current spot price over time
        </p>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="daysLeft"
            label={{ value: "Days to Expiry", position: "insideBottomRight", offset: -5 }}
            type="number"
            stroke="var(--color-text-muted)"
          />
          <YAxis
            label={{ value: "Strategy Value ($)", angle: -90, position: "insideLeft" }}
            stroke="var(--color-text-muted)"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
            formatter={(value: number) => `$${value.toFixed(2)}`}
            labelFormatter={(value: number) => `${value}d`}
          />
          <ReferenceLine
            y={0}
            stroke="var(--color-text-muted)"
            strokeOpacity={0.3}
          />
          {selectedDays !== undefined && (
            <ReferenceLine
              x={selectedDays}
              stroke="var(--color-accent)"
              strokeDasharray="5 5"
              label={{ value: "Scenario", position: "top", fill: "var(--color-text-muted)" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-accent)"
            name="Strategy Value"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
