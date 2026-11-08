"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useUserQuery } from "@/lib/use-user-query";
import {
  availableRanges,
  buildChartRows,
  CHART_RANGES,
  defaultRange,
  MIN_CHART_BARS,
  type ChartRange,
  type ChartRow,
} from "@/lib/chart-data";
import { formatCompact, formatPct } from "@/lib/research";
import { formatCents, formatDate, formatShortDate } from "@/lib/utils";
import type { OhlcvBar } from "@/lib/technicals";
import { Term } from "@/components/ui/term";
import { Card, signClass } from "./ui";

// Series colours: the app's validated categorical slots, in fixed order.
const C = {
  close: "var(--color-text)",
  sma20: "var(--chart-cat-1)",
  sma50: "var(--chart-cat-2)",
  sma200: "var(--chart-cat-3)",
  volAvg: "var(--chart-cat-4)",
  rsi: "var(--chart-cat-5)",
  macd: "var(--chart-cat-1)",
  signal: "var(--chart-cat-2)",
};

const AXIS_WIDTH = 56;
const AXIS_TICK = { fontSize: 11, fill: "var(--color-text-muted)" };
const SYNC = "price-indicators";

async function loadBars(symbol: string): Promise<OhlcvBar[]> {
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 2);
  const { data, error } = await supabaseBrowser
    .from("market_bars")
    .select("date, open_cents, high_cents, low_cents, close_cents, volume")
    .eq("symbol", symbol)
    .gte("date", from.toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as OhlcvBar[];
}

export function PriceChartCard({ symbol }: { symbol: string }) {
  const { data, error, loading } = useUserQuery(() => loadBars(symbol), [symbol]);

  if (loading) {
    return (
      <Card title="Price & indicators">
        <div className="flex h-[480px] items-center justify-center text-sm text-text-muted">Loading chart…</div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Price & indicators">
        <p className="text-sm text-loss">Could not load price history: {error}</p>
      </Card>
    );
  }
  const bars = data ?? [];
  if (bars.length < MIN_CHART_BARS) {
    return (
      <Card title="Price & indicators">
        <p className="py-6 text-center text-sm text-text-muted">
          {bars.length === 0 ? "No price history stored for this ticker yet." : `Only ${bars.length} sessions stored so far.`}{" "}
          History builds up from the daily market-data ingest; the chart appears once {MIN_CHART_BARS} sessions are available.
        </p>
      </Card>
    );
  }
  return <PriceChart key={symbol} bars={bars} />;
}

/** Line key for the readout/legend: a short stroke in the series colour. */
function Key({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="8" aria-hidden className="shrink-0">
      <line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 2" : undefined} />
    </svg>
  );
}

function ReadoutItem({
  color,
  dashed,
  term,
  label,
  value,
  valueClass = "",
  muted,
}: {
  color?: string;
  dashed?: boolean;
  term: string;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  muted?: boolean;
}) {
  return (
    <span data-term-row className={"inline-flex items-center gap-1.5 " + (muted ? "opacity-50" : "")}>
      {color && <Key color={color} dashed={dashed} />}
      <span className="text-text-muted">
        <Term k={term}>{label}</Term>
      </span>
      <span className={"tabular font-medium " + valueClass}>{value}</span>
    </span>
  );
}

const cents = (v: number | null) => (v === null ? "—" : formatCents(Math.round(v)));
// Whole dollars on the axis, except for low-priced stocks where cents matter.
const dollarsTick = (v: number) => `$${(v / 100).toFixed(v < 2000 ? 2 : 0)}`;

function Readout({ row, hasSma200, hovering }: { row: ChartRow; hasSma200: boolean; hovering: boolean }) {
  const relVol = row.volAvg20 ? row.volume / row.volAvg20 : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-live="polite">
      <span className="tabular font-medium text-text">
        {formatDate(`${row.date}T12:00:00Z`)}
        {!hovering && <span className="ml-1 font-normal text-text-subtle">(latest)</span>}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Key color={C.close} />
        <span className="text-text-muted">Close</span>
        <span className="tabular font-medium">{formatCents(row.close)}</span>
        <span className={"tabular " + signClass(row.change_pct)}>{formatPct(row.change_pct)}</span>
      </span>
      <ReadoutItem color={C.sma20} term="sma20" label="SMA 20" value={cents(row.sma20)} />
      <ReadoutItem color={C.sma50} term="sma50" label="SMA 50" value={cents(row.sma50)} />
      <ReadoutItem
        color={C.sma200}
        term="sma200"
        label="SMA 200"
        value={hasSma200 ? cents(row.sma200) : "needs 200 sessions"}
        muted={!hasSma200}
      />
      <ReadoutItem
        term="volume"
        label="Vol"
        value={
          <>
            {formatCompact(row.volume)}
            {relVol !== null && <span className="ml-1 font-normal text-text-subtle">({relVol.toFixed(2)}× avg)</span>}
          </>
        }
      />
      <ReadoutItem color={C.rsi} term="rsi14" label="RSI 14" value={row.rsi === null ? "—" : row.rsi.toFixed(1)} />
      <ReadoutItem color={C.macd} term="macd" label="MACD" value={row.macd === null ? "—" : (row.macd / 100).toFixed(2)} />
      <ReadoutItem color={C.signal} dashed term="macd_signal" label="Signal" value={row.signal === null ? "—" : (row.signal / 100).toFixed(2)} />
      <ReadoutItem
        term="macd_hist"
        label="Hist"
        value={row.hist === null ? "—" : (row.hist / 100).toFixed(2)}
        valueClass={signClass(row.hist)}
      />
    </div>
  );
}

function PaneLabel({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div data-term-row className="pointer-events-auto absolute left-[60px] top-0 z-10 text-[11px] text-text-subtle">
      <Term k={term}>{children}</Term>
    </div>
  );
}

function PriceChart({ bars }: { bars: OhlcvBar[] }) {
  const ranges = availableRanges(bars.length);
  const [range, setRange] = useState<ChartRange>(() => defaultRange(bars.length));
  const [hover, setHover] = useState<number | null>(null);
  const rows = useMemo(() => buildChartRows(bars, range), [bars, range]);
  const hasSma200 = rows.some((r) => r.sma200 !== null);
  const current = rows[hover ?? rows.length - 1] ?? rows[rows.length - 1];

  // Recharts reports the hovered index on every synced pane's own mouse move.
  const track = {
    syncId: SYNC,
    onMouseMove: (s: { activeTooltipIndex?: number }) =>
      setHover(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null),
    onMouseLeave: () => setHover(null),
  };
  const cursorOnly = (
    <Tooltip
      content={() => null}
      cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
      isAnimationActive={false}
    />
  );
  const grid = <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />;
  const hiddenX = <XAxis dataKey="date" hide />;
  const margin = { top: 6, right: 8, left: 0, bottom: 0 };
  const tickDates = (d: string) => formatShortDate(`${d}T12:00:00Z`);

  return (
    <Card
      title="Price & indicators"
      action={
        <div role="group" aria-label="Chart range" className="flex rounded-md border border-border p-0.5">
          {(Object.keys(CHART_RANGES) as ChartRange[]).map((r) => {
            const enabled = ranges.includes(r);
            return (
              <button
                key={r}
                type="button"
                disabled={!enabled}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={
                  "rounded px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30 " +
                  (range === r ? "bg-muted font-medium text-text" : "text-text-muted hover:text-text")
                }
              >
                {r}
              </button>
            );
          })}
        </div>
      }
    >
      {current && <Readout row={current} hasSma200={hasSma200} hovering={hover !== null} />}

      <div className="mt-3 space-y-1">
        {/* Price */}
        <div className="relative">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows} margin={margin} {...track}>
              {grid}
              {hiddenX}
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={dollarsTick}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={AXIS_WIDTH}
              />
              {cursorOnly}
              <Line dataKey="sma200" stroke={C.sma200} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="sma50" stroke={C.sma50} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="sma20" stroke={C.sma20} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line
                dataKey="close"
                stroke={C.close}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Volume */}
        <div className="relative">
          <PaneLabel term="volume">Volume · 20-day avg</PaneLabel>
          <ResponsiveContainer width="100%" height={72}>
            <ComposedChart data={rows} margin={{ ...margin, top: 14 }} {...track}>
              {hiddenX}
              <YAxis tickFormatter={(v) => formatCompact(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={AXIS_WIDTH} tickCount={3} />
              {cursorOnly}
              <Bar dataKey="volume" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {rows.map((r) => (
                  <Cell
                    key={r.date}
                    fill={r.volAvg20 && r.volume >= 2 * r.volAvg20 ? "var(--color-accent)" : "var(--color-border-strong)"}
                  />
                ))}
              </Bar>
              <Line dataKey="volAvg20" stroke={C.volAvg} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RSI */}
        <div className="relative">
          <PaneLabel term="rsi14">RSI 14 · 30 / 70</PaneLabel>
          <ResponsiveContainer width="100%" height={84}>
            <LineChart data={rows} margin={{ ...margin, top: 14 }} {...track}>
              {hiddenX}
              <YAxis domain={[0, 100]} ticks={[30, 70]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={AXIS_WIDTH} />
              <ReferenceArea y1={30} y2={70} fill="var(--color-muted)" fillOpacity={0.6} ifOverflow="hidden" />
              <ReferenceLine y={70} stroke="var(--color-border-strong)" strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="var(--color-border-strong)" strokeDasharray="3 3" />
              {cursorOnly}
              <Line dataKey="rsi" stroke={C.rsi} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* MACD */}
        <div className="relative">
          <PaneLabel term="macd">MACD · signal · histogram</PaneLabel>
          <ResponsiveContainer width="100%" height={104}>
            <ComposedChart data={rows} margin={{ ...margin, top: 14 }} {...track}>
              {grid}
              <XAxis
                dataKey="date"
                tickFormatter={tickDates}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis tickFormatter={(v) => (v / 100).toFixed(1)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={AXIS_WIDTH} tickCount={3} />
              <ReferenceLine y={0} stroke="var(--color-border-strong)" />
              {cursorOnly}
              <Bar dataKey="hist" isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.date} fill={(r.hist ?? 0) >= 0 ? "var(--color-gain)" : "var(--color-loss)"} fillOpacity={0.45} />
                ))}
              </Bar>
              <Line dataKey="macd" stroke={C.macd} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="signal" stroke={C.signal} strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-text-subtle">
        Daily closes from the market-data ingest (end of day). Hover a pane to read any session; bars in accent mark volume ≥ 2× its 20-day average.
      </p>
    </Card>
  );
}
