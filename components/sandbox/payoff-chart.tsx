"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export interface PayoffChartData {
  price: number;
  atExpiry: number;
  today: number;
  minus7d: number;
  minus14d: number;
}

export interface PayoffChartProps {
  data: PayoffChartData[];
  spotPrice: number;
  selectedPrice?: number;
}

export function PayoffChart({
  data,
  spotPrice,
  selectedPrice,
}: PayoffChartProps) {
  return (
    <div className="w-full h-full min-h-96 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">P&L vs Underlying Price</h3>
        <p className="text-xs text-text-muted mt-1">
          Strategy P&L across price ranges and time decay
        </p>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="price"
            label={{ value: "Underlying Price ($)", position: "insideBottomRight", offset: -5 }}
            type="number"
            stroke="var(--color-text-muted)"
          />
          <YAxis
            label={{ value: "Strategy P&L ($)", angle: -90, position: "insideLeft" }}
            stroke="var(--color-text-muted)"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
            formatter={(value: number) => `$${value.toFixed(2)}`}
          />
          <Legend />
          <ReferenceLine
            x={spotPrice}
            stroke="var(--color-accent)"
            strokeDasharray="5 5"
            label={{ value: "Current Spot", position: "top", fill: "var(--color-text-muted)" }}
          />
          <ReferenceLine
            y={0}
            stroke="var(--color-text-muted)"
            strokeOpacity={0.3}
          />
          {selectedPrice && selectedPrice !== spotPrice && (
            <ReferenceLine
              x={selectedPrice}
              stroke="var(--color-text-subtle)"
              strokeDasharray="2 2"
              label={{ value: "Scenario", position: "top", fill: "var(--color-text-muted)" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="atExpiry"
            stroke="var(--color-loss)"
            name="At Expiry"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="today"
            stroke="var(--color-accent)"
            name="Today"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="minus7d"
            stroke="var(--color-text-muted)"
            name="Today - 7d"
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 5"
          />
          <Line
            type="monotone"
            dataKey="minus14d"
            stroke="var(--color-text-subtle)"
            name="Today - 14d"
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 5"
            opacity={0.7}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
