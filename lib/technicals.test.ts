import { describe, expect, it } from "vitest";
import {
  atr,
  computeTechnicals,
  dailyReturns,
  ema,
  emaSeries,
  historicalVolatility,
  macd,
  macdSeries,
  maxDrawdown,
  pctChange,
  rsi,
  rsiSeries,
  sma,
  smaSeries,
  stdev,
  streak,
  volumeAvgSeries,
  type OhlcvBar,
} from "./technicals";

function bars(closes: number[], opts: { range?: number; volume?: number[] } = {}): OhlcvBar[] {
  const range = opts.range ?? 0;
  return closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open_cents: c,
    high_cents: c + range / 2,
    low_cents: c - range / 2,
    close_cents: c,
    volume: opts.volume?.[i] ?? 1000,
  }));
}

describe("moving averages", () => {
  it("sma averages the trailing window and is null when short", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(sma([1, 2], 3)).toBeNull();
  });

  it("ema seeds with the SMA then applies k = 2/(n+1)", () => {
    // seed avg(1,2,3)=2; k=0.5 → 3 → 4
    expect(emaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(ema([1, 2], 3)).toBeNull();
  });
});

describe("rsi (Wilder)", () => {
  it("matches a hand-computed series", () => {
    // d = +1,-1,+2,-1 ; period 2 → avgGain .5/.5 → 1.25/.25 → .625/.625 → RS 1
    expect(rsi([10, 11, 10, 12, 11], 2)).toBeCloseTo(50, 10);
  });
  it("is 100 for a series with no losses, 50 for a flat one", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3)).toBe(50);
  });
  it("needs period + 1 closes", () => {
    expect(rsi([1, 2, 3], 3)).toBeNull();
  });
});

describe("macd", () => {
  it("is zero on a flat series and null when history is short", () => {
    const flat = new Array(40).fill(100);
    expect(macd(flat)).toEqual({ line: 0, signal: 0, histogram: 0 });
    expect(macd(new Array(30).fill(100))).toBeNull();
  });
  it("turns positive in an uptrend", () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(macd(up)!.line).toBeGreaterThan(0);
  });
});

describe("atr", () => {
  it("equals the constant bar range when there are no gaps", () => {
    expect(atr(bars(new Array(20).fill(1000), { range: 20 }), 14)).toBeCloseTo(20, 10);
  });
  it("counts gaps through the previous close", () => {
    // flat bars at 100 then a bar at 110 with zero range: TR = |110-100| = 10
    const b = bars([100, 100, 110]);
    expect(atr(b, 2)).toBeCloseTo(5, 10); // (0 + 10) / 2
  });
});

describe("returns and volatility", () => {
  it("dailyReturns and pctChange", () => {
    const r = dailyReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(pctChange([100, 110, 121], 2)).toBeCloseTo(21, 10);
    expect(pctChange([100], 1)).toBeNull();
  });
  it("stdev is the sample standard deviation", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stdev([1])).toBeNull();
  });
  it("historical volatility is zero for constant growth", () => {
    const g = Array.from({ length: 25 }, (_, i) => 100 * 1.01 ** i);
    expect(historicalVolatility(g, 20)).toBeCloseTo(0, 10);
    expect(historicalVolatility(g.slice(0, 10), 20)).toBeNull();
  });
});

describe("streak and drawdown", () => {
  it("counts consecutive closes in one direction", () => {
    expect(streak([1, 2, 3, 4])).toBe(3);
    expect(streak([1, 2, 3, 2, 1, 0])).toBe(-3);
    expect(streak([1, 1])).toBe(0);
  });
  it("max drawdown is the worst peak-to-trough", () => {
    expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-25, 10);
    expect(maxDrawdown([100])).toBeNull();
  });
});

describe("computeTechnicals", () => {
  it("returns nulls rather than zeros on short history", () => {
    const t = computeTechnicals(bars([100, 101, 102]))!;
    expect(t.sma20_cents).toBeNull();
    expect(t.rsi14).toBeNull();
    expect(t.rel_volume).toBeNull();
    expect(t.ret_1d).toBe(0.99); // 102/101 − 1
    expect(t.bars).toBe(3);
  });

  it("measures relative volume against the 20 prior sessions only", () => {
    const vols = [...new Array(25).fill(1000), 3000];
    const t = computeTechnicals(bars(new Array(26).fill(5000), { volume: vols }))!;
    expect(t.avg_volume_20d).toBe(1000);
    expect(t.rel_volume).toBe(3);
  });

  it("reports SMAs in cents and distances in percent", () => {
    const closes = [...new Array(49).fill(10000), 11000];
    const t = computeTechnicals(bars(closes))!;
    expect(t.sma50_cents).toBe(10020);
    expect(t.dist_sma50_pct).toBeCloseTo(9.78, 2);
    expect(t.sma200_cents).toBeNull();
    expect(t.window_high_cents).toBe(11000);
    expect(t.window_days).toBe(50);
  });

  it("is null for an empty series", () => {
    expect(computeTechnicals([])).toBeNull();
  });
});

// --- series --------------------------------------------------------------

describe("series agree with the scalar indicators", () => {
  // A deterministic wiggly series long enough for every warm-up.
  const closes = Array.from({ length: 120 }, (_, i) => 10000 + Math.round(400 * Math.sin(i / 5) + i * 7));

  it("smaSeries aligns with sma and is null during warm-up", () => {
    const s = smaSeries(closes, 20);
    expect(s).toHaveLength(closes.length);
    expect(s[18]).toBeNull();
    expect(s[19]).toBeCloseTo(sma(closes.slice(0, 20), 20)!, 9);
    expect(s.at(-1)).toBeCloseTo(sma(closes, 20)!, 9);
  });

  it("rsiSeries' last value equals rsi", () => {
    const s = rsiSeries(closes, 14);
    expect(s[13]).toBeNull();
    expect(s[14]).not.toBeNull();
    expect(s.at(-1)).toBeCloseTo(rsi(closes, 14)!, 9);
    expect(rsiSeries([1, 2, 3], 14).every((v) => v === null)).toBe(true);
  });

  it("macdSeries' last values equal macd", () => {
    const s = macdSeries(closes);
    const m = macd(closes)!;
    expect(s.line.at(-1)).toBeCloseTo(m.line, 9);
    expect(s.signal.at(-1)).toBeCloseTo(m.signal, 9);
    expect(s.histogram.at(-1)).toBeCloseTo(m.histogram, 9);
    expect(s.line[24]).toBeNull();
    expect(s.line[25]).not.toBeNull();
    expect(s.signal[32]).toBeNull();
    expect(s.signal[33]).not.toBeNull();
  });

  it("volumeAvgSeries averages the prior sessions only, like computeTechnicals", () => {
    const vols = [...new Array(25).fill(1000), 3000];
    const b = bars(new Array(26).fill(5000), { volume: vols });
    const s = volumeAvgSeries(b, 20);
    expect(s[19]).toBeNull();
    expect(s[20]).toBe(1000);
    expect(s.at(-1)).toBe(computeTechnicals(b)!.avg_volume_20d);
  });
});
