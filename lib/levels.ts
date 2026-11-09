/**
 * Price levels for strike anchoring: support/resistance from the last N
 * sessions, and the gap size a structure must survive.
 *
 * Pure functions over oldest-first EOD bars, prices in integer cents. Used by
 * the options strategy framework (lib/strategy-*.ts) — short strikes anchor to
 * these levels rather than to round numbers or deltas alone.
 */
import { atr, type OhlcvBar } from "./technicals";

export const LEVEL_SESSIONS = 20;

export type Levels = {
  /** Clustered levels below the reference price, nearest first. */
  supports: number[];
  /** Clustered levels above the reference price, nearest first. */
  resistances: number[];
  /** Highest high / lowest low over the window. */
  window_high_cents: number;
  window_low_cents: number;
  sessions: number;
};

/**
 * Swing pivots (a high/low that is the extreme of the 2 bars on each side)
 * plus the window high and low, clustered within `0.5 × ATR14` and split
 * around `refCents` (defaults to the last close). Returns null with fewer
 * than 5 bars in the window.
 */
export function supportResistance(
  bars: OhlcvBar[],
  sessions = LEVEL_SESSIONS,
  refCents?: number
): Levels | null {
  const win = bars.slice(-sessions);
  if (win.length < 5) return null;
  const ref = refCents ?? win[win.length - 1].close_cents;
  const a = atr(bars) ?? averageRange(win);
  const tol = Math.max(1, 0.5 * a);

  const raw: number[] = [];
  const hi = Math.max(...win.map((b) => b.high_cents));
  const lo = Math.min(...win.map((b) => b.low_cents));
  raw.push(hi, lo);
  for (let i = 2; i < win.length - 2; i++) {
    const h = win[i].high_cents;
    const l = win[i].low_cents;
    const around = [win[i - 2], win[i - 1], win[i + 1], win[i + 2]];
    if (around.every((b) => b.high_cents <= h)) raw.push(h);
    if (around.every((b) => b.low_cents >= l)) raw.push(l);
  }

  const levels = cluster(raw, tol);
  return {
    supports: levels.filter((v) => v < ref).sort((x, y) => y - x),
    resistances: levels.filter((v) => v > ref).sort((x, y) => x - y),
    window_high_cents: hi,
    window_low_cents: lo,
    sessions: win.length,
  };
}

/** Merge values closer than `tol` into their (rounded) mean. */
export function cluster(values: number[], tol: number): number[] {
  const sorted = [...values].sort((x, y) => x - y);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => Math.round(g.reduce((s, v) => s + v, 0) / g.length));
}

function averageRange(bars: OhlcvBar[]): number {
  return bars.reduce((s, b) => s + (b.high_cents - b.low_cents), 0) / bars.length;
}

/** Largest |open − previous close| over the last `sessions` bars, in cents. */
export function largestGap(bars: OhlcvBar[], sessions = LEVEL_SESSIONS): number | null {
  const win = bars.slice(-(sessions + 1));
  if (win.length < 2) return null;
  let g = 0;
  for (let i = 1; i < win.length; i++) {
    g = Math.max(g, Math.abs(win[i].open_cents - win[i - 1].close_cents));
  }
  return g;
}

/**
 * The move a structure must survive: the larger of the biggest recent gap
 * and one ATR14. Null when neither is computable.
 */
export function gapSize(bars: OhlcvBar[], sessions = LEVEL_SESSIONS): number | null {
  const g = largestGap(bars, sessions);
  const a = atr(bars);
  if (g === null && a === null) return null;
  return Math.round(Math.max(g ?? 0, a ?? 0));
}
