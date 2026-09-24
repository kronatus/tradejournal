import { describe, it, expect } from "vitest";
import { buildSpreadCurves, positionValueAt, type PayoffLeg } from "./payoff";

// The QQQ bear call spread: short the 735 call, long the 740, 20 lots.
const bearCallSpread: PayoffLeg[] = [
  { occ_symbol: "O:QQQ261002C00073500", strike: 735, expiry: "2026-10-02",
    optionType: "call", side: "short", qty: 20, iv: 0.21 },
  { occ_symbol: "O:QQQ261002C00074000", strike: 740, expiry: "2026-10-02",
    optionType: "call", side: "long", qty: 20, iv: 0.21 },
];

const EXPIRY_MS = Date.UTC(2026, 9, 2);
const TODAY = new Date(Date.UTC(2026, 8, 24));

describe("positionValueAt — at expiry", () => {
  it("is worthless below the short strike", () => {
    expect(positionValueAt(bearCallSpread, 700, EXPIRY_MS, 0.05)).toBeCloseTo(0, 6);
  });

  it("caps at the spread width above the long strike", () => {
    // (735-740) intrinsic difference = -5/share * 100 * 20 lots = -10,000
    expect(positionValueAt(bearCallSpread, 800, EXPIRY_MS, 0.05)).toBeCloseTo(-10000, 6);
  });

  it("is linear between the strikes", () => {
    // At 737.50, halfway across a 5-wide spread.
    expect(positionValueAt(bearCallSpread, 737.5, EXPIRY_MS, 0.05)).toBeCloseTo(-5000, 6);
  });

  it("is negative everywhere for a credit spread", () => {
    for (const p of [700, 730, 735, 737, 740, 760, 800]) {
      expect(positionValueAt(bearCallSpread, p, EXPIRY_MS, 0.05)).toBeLessThanOrEqual(0);
    }
  });

  it("flips sign for the equivalent debit spread", () => {
    const debit = bearCallSpread.map((l) => ({
      ...l, side: l.side === "long" ? ("short" as const) : ("long" as const),
    }));
    expect(positionValueAt(debit, 800, EXPIRY_MS, 0.05)).toBeCloseTo(10000, 6);
  });
});

describe("positionValueAt — before expiry", () => {
  it("still sits inside the spread's bounds", () => {
    const mid = positionValueAt(bearCallSpread, 739, Date.UTC(2026, 8, 24), 0.05);
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(-10000);
  });

  it("converges toward intrinsic as expiry approaches", () => {
    const far = positionValueAt(bearCallSpread, 800, Date.UTC(2026, 8, 24), 0.05);
    const near = positionValueAt(bearCallSpread, 800, Date.UTC(2026, 9, 1), 0.05);
    expect(Math.abs(near - -10000)).toBeLessThan(Math.abs(far - -10000));
  });
});

describe("buildSpreadCurves", () => {
  it("draws one line per day when expiry is close", () => {
    const { series } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739,
      asOf: new Date(Date.UTC(2026, 9, 0)), // 2 days out
    });
    expect(series).toHaveLength(3);
    expect(series[0].label).toBe("30 Sep");
    expect(series[2].isExpiry).toBe(true);
    expect(series[2].daysToExpiry).toBe(0);
  });

  it("samples evenly and caps the line count when expiry is far", () => {
    const { series } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739, asOf: TODAY, maxCurves: 5,
    });
    expect(series).toHaveLength(5);
    expect(series[0].date).toBe("2026-09-24");
    expect(series[4].date).toBe("2026-10-02");
    expect(series[4].isExpiry).toBe(true);
  });

  it("spans the strikes with headroom and includes spot", () => {
    const { data } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739, asOf: TODAY,
    });
    const prices = data.map((d) => d.price);
    expect(Math.min(...prices)).toBeLessThan(735);
    expect(Math.max(...prices)).toBeGreaterThan(740);
    expect(Math.min(...prices)).toBeLessThan(739);
    expect(Math.max(...prices)).toBeGreaterThan(739);
  });

  it("gives every series a value at every price", () => {
    const { data, series } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739, asOf: TODAY,
    });
    for (const row of data) {
      for (const s of series) expect(typeof row[s.key]).toBe("number");
    }
  });

  it("makes the expiry line monotonically non-increasing in price", () => {
    const { data, series } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739, asOf: TODAY,
    });
    const expiryKey = series.find((s) => s.isExpiry)!.key;
    for (let i = 1; i < data.length; i++) {
      expect(data[i][expiryKey]).toBeLessThanOrEqual(data[i - 1][expiryKey] + 1e-6);
    }
  });

  it("returns nothing without legs or a spot price", () => {
    expect(buildSpreadCurves({ legs: [], spotPrice: 739 }).data).toHaveLength(0);
    expect(buildSpreadCurves({ legs: bearCallSpread, spotPrice: 0 }).data).toHaveLength(0);
  });

  it("handles an already-expired position with a single intrinsic line", () => {
    const { series } = buildSpreadCurves({
      legs: bearCallSpread, spotPrice: 739, asOf: new Date(Date.UTC(2026, 10, 1)),
    });
    expect(series).toHaveLength(1);
    expect(series[0].isExpiry).toBe(true);
  });
});
