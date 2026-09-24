import { bsmPrice } from "./pricing";
import { appZoneTodayUtcMs } from "./utils";

/** Matches the sandbox's assumption; see app/sandbox/page.tsx. */
export const DEFAULT_RISK_FREE_RATE = 0.05;

export type PayoffLeg = {
  occ_symbol: string;
  /** Strike in dollars. */
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  optionType: "call" | "put";
  side: "long" | "short";
  qty: number;
  /** Implied volatility as a decimal, e.g. 0.21. */
  iv: number;
};

export type CurveSeries = {
  /** dataKey in the chart rows. */
  key: string;
  /** e.g. "12 Sep" */
  label: string;
  /** YYYY-MM-DD */
  date: string;
  daysToExpiry: number;
  isExpiry: boolean;
};

export type CurvePoint = { price: number } & Record<string, number>;

export type SpreadCurves = {
  data: CurvePoint[];
  series: CurveSeries[];
  /** Latest expiry across the legs. */
  expiry: string;
};

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const MS_PER_DAY = 86_400_000;

function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function labelFor(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
}

/**
 * Pick which days to draw. One line per remaining day while that stays legible,
 * otherwise an evenly spaced sample. Today and expiry are always included.
 */
function chooseDays(todayMs: number, expiryMs: number, maxCurves: number): number[] {
  const totalDays = Math.max(0, Math.round((expiryMs - todayMs) / MS_PER_DAY));
  if (totalDays === 0) return [expiryMs];
  if (totalDays + 1 <= maxCurves) {
    return Array.from({ length: totalDays + 1 }, (_, i) => todayMs + i * MS_PER_DAY);
  }
  const days: number[] = [];
  for (let i = 0; i < maxCurves; i++) {
    const offset = Math.round((totalDays * i) / (maxCurves - 1));
    days.push(todayMs + offset * MS_PER_DAY);
  }
  return Array.from(new Set(days));
}

/**
 * Value of the whole position at a given underlying price and valuation date.
 * Signed the same way as currentValueCents: long legs add, short legs subtract,
 * so a credit spread is negative (what it would cost to buy back).
 */
export function positionValueAt(
  legs: PayoffLeg[],
  underlyingPrice: number,
  valuationMs: number,
  riskFreeRate: number
): number {
  let total = 0;
  for (const leg of legs) {
    const daysLeft = Math.max(0, (utcDay(leg.expiry) - valuationMs) / MS_PER_DAY);
    const price = bsmPrice({
      S: underlyingPrice,
      K: leg.strike,
      r: riskFreeRate,
      T: daysLeft / 365,
      sigma: leg.iv,
      type: leg.optionType,
    });
    total += price * leg.qty * 100 * (leg.side === "long" ? 1 : -1);
  }
  return total;
}

/**
 * Build the value-vs-underlying curves, one series per valuation day between
 * today and expiry.
 */
export function buildSpreadCurves(params: {
  legs: PayoffLeg[];
  spotPrice: number;
  riskFreeRate?: number;
  /** Defaults to now. Date-only; time of day is ignored. */
  asOf?: Date;
  /** Upper bound on the number of lines drawn. */
  maxCurves?: number;
  /** Number of price samples along the x axis. */
  steps?: number;
}): SpreadCurves {
  const {
    legs,
    spotPrice,
    riskFreeRate = DEFAULT_RISK_FREE_RATE,
    asOf = new Date(),
    maxCurves = 5,
    steps = 81,
  } = params;

  if (legs.length === 0 || !(spotPrice > 0)) {
    return { data: [], series: [], expiry: "" };
  }

  // Calendar day in the app's zone. Expiry dates are plain calendar dates, so
  // both sides of the comparison are UTC-midnight stamps of a local day.
  const todayMs = appZoneTodayUtcMs(asOf);
  const expiryMs = Math.max(...legs.map((l) => utcDay(l.expiry)));
  // A past expiry still draws a single intrinsic-value line.
  const days = chooseDays(Math.min(todayMs, expiryMs), expiryMs, maxCurves);

  const series: CurveSeries[] = days.map((ms, i) => ({
    key: `d${i}`,
    label: labelFor(ms),
    date: toIsoDay(ms),
    daysToExpiry: Math.round((expiryMs - ms) / MS_PER_DAY),
    isExpiry: ms === expiryMs,
  }));

  // Span the strikes and spot with headroom, so the flat wings are visible.
  const strikes = legs.map((l) => l.strike);
  const low = Math.min(...strikes, spotPrice) * 0.94;
  const high = Math.max(...strikes, spotPrice) * 1.06;
  const stride = (high - low) / (steps - 1);

  const data: CurvePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const price = low + stride * i;
    const row: CurvePoint = { price: Number(price.toFixed(2)) };
    for (let s = 0; s < days.length; s++) {
      row[series[s].key] = Number(
        positionValueAt(legs, price, days[s], riskFreeRate).toFixed(2)
      );
    }
    data.push(row);
  }

  return { data, series, expiry: toIsoDay(expiryMs) };
}
