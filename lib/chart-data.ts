/**
 * Rows for the Research tab's price & indicator chart.
 *
 * Indicators are computed over the FULL history and only then sliced to the
 * selected range, so the left edge of a 1-month view still has a correct
 * SMA200 rather than a warm-up gap. Prices stay in integer cents.
 */
import {
  macdSeries,
  rsiSeries,
  smaSeries,
  volumeAvgSeries,
  type OhlcvBar,
} from "./technicals";

export const CHART_RANGES = {
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  All: Infinity,
} as const;

export type ChartRange = keyof typeof CHART_RANGES;

/** Fewer bars than this and the chart shows an empty state instead. */
export const MIN_CHART_BARS = 20;

export type ChartRow = {
  date: string;
  close: number;
  /** Percent change vs the previous session, null for the first bar. */
  change_pct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  volume: number;
  volAvg20: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
};

export function buildChartRows(bars: OhlcvBar[], range: ChartRange): ChartRow[] {
  if (!bars.length) return [];
  const closes = bars.map((b) => b.close_cents);
  const s20 = smaSeries(closes, 20);
  const s50 = smaSeries(closes, 50);
  const s200 = smaSeries(closes, 200);
  const r = rsiSeries(closes, 14);
  const m = macdSeries(closes);
  const va = volumeAvgSeries(bars, 20);

  const rows: ChartRow[] = bars.map((b, i) => ({
    date: b.date,
    close: b.close_cents,
    change_pct: i > 0 && closes[i - 1] > 0 ? (closes[i] / closes[i - 1] - 1) * 100 : null,
    sma20: s20[i],
    sma50: s50[i],
    sma200: s200[i],
    volume: b.volume,
    volAvg20: va[i],
    rsi: r[i],
    macd: m.line[i],
    signal: m.signal[i],
    hist: m.histogram[i],
  }));
  const n = CHART_RANGES[range];
  return Number.isFinite(n) ? rows.slice(-n) : rows;
}

/**
 * Ranges worth offering: a range is available when the history covers more
 * than the next-smaller one (so 1Y is not offered for 4 months of data).
 * "All" is always offered once there is enough to chart at all.
 */
export function availableRanges(barCount: number): ChartRange[] {
  if (barCount < MIN_CHART_BARS) return [];
  const out: ChartRange[] = [];
  let prev = 0;
  for (const [k, n] of Object.entries(CHART_RANGES) as [ChartRange, number][]) {
    if (!Number.isFinite(n)) continue;
    if (barCount > prev) out.push(k);
    prev = n;
  }
  out.push("All");
  return out;
}

/** The range shown first: 6M when available, else the longest offered. */
export function defaultRange(barCount: number): ChartRange {
  const avail = availableRanges(barCount);
  if (avail.includes("6M") && barCount >= CHART_RANGES["6M"]) return "6M";
  return "All";
}
