import { describe, expect, it } from "vitest";
import { availableRanges, buildChartRows, defaultRange } from "./chart-data";
import { sma, type OhlcvBar } from "./technicals";

function bars(n: number): OhlcvBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 10000 + Math.round(300 * Math.sin(i / 7) + i * 5);
    return {
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      open_cents: c,
      high_cents: c + 50,
      low_cents: c - 50,
      close_cents: c,
      volume: 1_000_000 + i,
    };
  });
}

describe("buildChartRows", () => {
  it("slices to the range after computing on the full history", () => {
    const b = bars(300);
    const rows = buildChartRows(b, "1M");
    expect(rows).toHaveLength(21);
    expect(rows.at(-1)!.date).toBe(b.at(-1)!.date);
    // SMA200 is defined at the left edge of a 1-month view…
    expect(rows[0].sma200).not.toBeNull();
    // …and equals the SMA of the 200 closes ending there.
    const idx = 300 - 21;
    expect(rows[0].sma200).toBeCloseTo(sma(b.slice(0, idx + 1).map((x) => x.close_cents), 200)!, 9);
  });

  it("keeps warm-up nulls when history is short", () => {
    const rows = buildChartRows(bars(60), "All");
    expect(rows).toHaveLength(60);
    expect(rows.every((r) => r.sma200 === null)).toBe(true);
    expect(rows[18].sma20).toBeNull();
    expect(rows[19].sma20).not.toBeNull();
    expect(rows[0].change_pct).toBeNull();
    expect(rows[1].change_pct).not.toBeNull();
  });

  it("handles empty history", () => {
    expect(buildChartRows([], "6M")).toEqual([]);
  });
});

describe("availableRanges / defaultRange", () => {
  it("offers nothing below the minimum history", () => {
    expect(availableRanges(10)).toEqual([]);
  });
  it("offers only ranges the history extends into", () => {
    expect(availableRanges(50)).toEqual(["1M", "3M", "All"]);
    expect(availableRanges(300)).toEqual(["1M", "3M", "6M", "1Y", "All"]);
  });
  it("defaults to 6M when there is enough, else All", () => {
    expect(defaultRange(300)).toBe("6M");
    expect(defaultRange(70)).toBe("All");
  });
});
