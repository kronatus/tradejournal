/**
 * Technical indicators over end-of-day bars.
 *
 * Pure functions, no I/O. Bars are oldest-first with prices in integer cents.
 * Price-valued outputs are cents (rounded to integers at the edge, in
 * `computeTechnicals`); returns and distances are percent units (1.5 = 1.5%);
 * volatility is an annualised decimal (0.25 = 25%). Anything the history is too
 * short to support is null — never zero, because zero is a claim.
 */

export type OhlcvBar = {
  date: string;
  open_cents: number;
  high_cents: number;
  low_cents: number;
  close_cents: number;
  volume: number;
};

const TRADING_DAYS_PER_YEAR = 252;

/** Simple moving average of the last `period` values, or null. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Full EMA series, seeded with the SMA of the first `period` values. Entries
 * before the seed are null so indices line up with the input.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function ema(values: number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

/** Wilder's RSI. Needs period + 1 closes. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD(fast, slow, signal) at the last bar. */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { line: number; signal: number; histogram: number } | null {
  if (closes.length < slow + signal - 1) return null;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const a = f[i];
    const b = s[i];
    if (a !== null && b !== null) line.push(a - b);
  }
  const sig = ema(line, signal);
  if (sig === null) return null;
  const last = line[line.length - 1];
  return { line: last, signal: sig, histogram: last - sig };
}

/** Wilder's Average True Range. Needs period + 1 bars. */
export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const { high_cents: h, low_cents: l } = bars[i];
    const pc = bars[i - 1].close_cents;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

/** Simple daily returns (fractions), oldest-first, length n-1. */
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1];
    out.push(p > 0 ? closes[i] / p - 1 : 0);
  }
  return out;
}

/** Sample standard deviation, or null for fewer than 2 values. */
export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Annualised close-to-close historical volatility over `period` returns. */
export function historicalVolatility(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const logs: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const p = closes[i - 1];
    if (p <= 0 || closes[i] <= 0) return null;
    logs.push(Math.log(closes[i] / p));
  }
  const sd = stdev(logs);
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Percent change over the last `days` bars (close to close). */
export function pctChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const from = closes[closes.length - 1 - days];
  if (from <= 0) return null;
  return (closes[closes.length - 1] / from - 1) * 100;
}

/** Consecutive up (+n) or down (−n) closes ending at the last bar. */
export function streak(closes: number[]): number {
  let n = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    const d = closes[i] - closes[i - 1];
    if (d === 0) break;
    const dir = d > 0 ? 1 : -1;
    if (n === 0 || Math.sign(n) === dir) n += dir;
    else break;
  }
  return n;
}

/** Largest peak-to-trough decline (percent, ≤ 0) over the closes given. */
export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.min(worst, (c / peak - 1) * 100);
  }
  return worst;
}

// --- Series (for charts) ----------------------------------------------------
//
// Each returns an array aligned index-for-index with its input, null during
// warm-up. The last element always equals the scalar function above; the
// tests pin that so the chart and the summary can never disagree.

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's RSI at every bar. */
export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () =>
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** MACD line, signal and histogram at every bar. */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { line: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const n = closes.length;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line: (number | null)[] = closes.map((_, i) => {
    const a = f[i];
    const b = s[i];
    return a !== null && b !== null ? a - b : null;
  });
  const firstLine = line.findIndex((v) => v !== null);
  const sig: (number | null)[] = new Array(n).fill(null);
  if (firstLine >= 0) {
    const defined = line.slice(firstLine) as number[];
    emaSeries(defined, signal).forEach((v, j) => (sig[firstLine + j] = v));
  }
  const histogram = line.map((v, i) => (v !== null && sig[i] !== null ? v - (sig[i] as number) : null));
  return { line, signal: sig, histogram };
}

/** Average volume of the `period` sessions BEFORE each bar (spike excluded). */
export function volumeAvgSeries(bars: OhlcvBar[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= period) out[i] = sum / period;
    sum += bars[i].volume;
    if (i >= period) sum -= bars[i - period].volume;
  }
  return out;
}

export type TechnicalSummary = {
  as_of: string;
  bars: number;
  close_cents: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_20d: number | null;
  ret_60d: number | null;
  sma20_cents: number | null;
  sma50_cents: number | null;
  sma200_cents: number | null;
  ema21_cents: number | null;
  dist_sma20_pct: number | null;
  dist_sma50_pct: number | null;
  dist_sma200_pct: number | null;
  rsi14: number | null;
  macd_line_cents: number | null;
  macd_signal_cents: number | null;
  macd_hist_cents: number | null;
  atr14_cents: number | null;
  atr14_pct: number | null;
  hv20: number | null;
  avg_volume_20d: number | null;
  rel_volume: number | null;
  /** Highest high / lowest low over the available window (≤ 252 bars). */
  window_high_cents: number | null;
  window_low_cents: number | null;
  window_days: number;
  dist_window_high_pct: number | null;
  max_drawdown_pct: number | null;
  streak: number;
};

const round = (v: number | null, dp = 2): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;
const roundCents = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.round(v);

/**
 * Everything the research page and the MCP `get_symbol_detail` tool report for
 * one symbol. Bars must be oldest-first and belong to a single symbol.
 */
export function computeTechnicals(bars: OhlcvBar[]): TechnicalSummary | null {
  if (bars.length === 0) return null;
  const closes = bars.map((b) => b.close_cents);
  const last = bars[bars.length - 1];
  const close = last.close_cents;
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const dist = (ref: number | null) => (ref && ref > 0 ? (close / ref - 1) * 100 : null);
  const m = macd(closes);
  const a = atr(bars);

  // Relative volume compares today's volume with the 20 sessions *before* it,
  // so a spike does not dilute its own baseline.
  const priorVol = bars.slice(-21, -1).map((b) => b.volume);
  const avgVol = priorVol.length === 20 ? priorVol.reduce((s, v) => s + v, 0) / 20 : null;

  const window = bars.slice(-252);
  const hi = Math.max(...window.map((b) => b.high_cents));
  const lo = Math.min(...window.map((b) => b.low_cents));

  return {
    as_of: last.date,
    bars: bars.length,
    close_cents: close,
    ret_1d: round(pctChange(closes, 1)),
    ret_5d: round(pctChange(closes, 5)),
    ret_20d: round(pctChange(closes, 20)),
    ret_60d: round(pctChange(closes, 60)),
    sma20_cents: roundCents(s20),
    sma50_cents: roundCents(s50),
    sma200_cents: roundCents(s200),
    ema21_cents: roundCents(ema(closes, 21)),
    dist_sma20_pct: round(dist(s20)),
    dist_sma50_pct: round(dist(s50)),
    dist_sma200_pct: round(dist(s200)),
    rsi14: round(rsi(closes), 1),
    macd_line_cents: roundCents(m?.line ?? null),
    macd_signal_cents: roundCents(m?.signal ?? null),
    macd_hist_cents: roundCents(m?.histogram ?? null),
    atr14_cents: roundCents(a),
    atr14_pct: round(a !== null && close > 0 ? (a / close) * 100 : null),
    hv20: round(historicalVolatility(closes), 4),
    avg_volume_20d: avgVol === null ? null : Math.round(avgVol),
    rel_volume: round(avgVol && avgVol > 0 ? last.volume / avgVol : null),
    window_high_cents: hi,
    window_low_cents: lo,
    window_days: window.length,
    dist_window_high_pct: round(hi > 0 ? (close / hi - 1) * 100 : null),
    max_drawdown_pct: round(maxDrawdown(closes.slice(-252))),
    streak: streak(closes),
  };
}
