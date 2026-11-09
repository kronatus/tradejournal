import { describe, expect, it } from "vitest";
import { cluster, gapSize, largestGap, supportResistance } from "./levels";
import type { OhlcvBar } from "./technicals";

const bar = (i: number, o: number, h: number, l: number, c: number): OhlcvBar => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`,
  open_cents: o,
  high_cents: h,
  low_cents: l,
  close_cents: c,
  volume: 1000,
});

/** A range-bound tape: swings between ~95 and ~105 with a close near 100. */
function rangeBars(): OhlcvBar[] {
  const closes = [100, 102, 104, 105, 103, 100, 97, 95, 96, 99, 102, 104, 105, 104, 101, 98, 96, 95, 97, 100];
  return closes.map((c, i) => bar(i, c * 100, (c + 0.5) * 100, (c - 0.5) * 100, c * 100));
}

describe("cluster", () => {
  it("merges values within tolerance into their mean", () => {
    expect(cluster([100, 101, 110, 111, 130], 2)).toEqual([101, 111, 130]);
  });
});

describe("supportResistance", () => {
  it("finds swing highs above and swing lows below the last close", () => {
    const lv = supportResistance(rangeBars())!;
    expect(lv.window_high_cents).toBe(10550);
    expect(lv.window_low_cents).toBe(9450);
    // Two swing lows at 94.50 cluster into one support; same for the highs.
    expect(lv.supports[0]).toBeLessThan(10000);
    expect(lv.supports[lv.supports.length - 1]).toBe(9450);
    expect(lv.resistances[lv.resistances.length - 1]).toBe(10550);
    // Nearest first.
    expect([...lv.supports].sort((a, b) => b - a)).toEqual(lv.supports);
    expect([...lv.resistances].sort((a, b) => a - b)).toEqual(lv.resistances);
  });

  it("splits around an explicit reference price", () => {
    const lv = supportResistance(rangeBars(), 20, 10600)!;
    expect(lv.resistances).toEqual([]);
    expect(lv.supports[0]).toBe(10550);
  });

  it("needs at least 5 bars", () => {
    expect(supportResistance(rangeBars().slice(0, 4))).toBeNull();
  });
});

describe("gaps", () => {
  it("measures the largest open-vs-previous-close gap", () => {
    const bars = rangeBars();
    bars[10] = { ...bars[10], open_cents: bars[9].close_cents + 450 };
    expect(largestGap(bars)).toBe(450);
  });

  it("uses the larger of the largest gap and ATR14", () => {
    const flat = rangeBars().map((b) => ({ ...b, open_cents: b.close_cents }));
    // No gaps at all: ATR (≥ 1 point ranges + close-to-close moves) wins.
    const g = gapSize(flat)!;
    expect(g).toBeGreaterThan(100);
    const gapped = [...flat];
    gapped[19] = { ...gapped[19], open_cents: gapped[18].close_cents + 2000 };
    expect(gapSize(gapped)).toBe(2000);
  });
});
