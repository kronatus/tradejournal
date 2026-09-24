import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Leg } from "./types";
import type { Quote } from "./schemas";

vi.mock("@/lib/quotes", () => ({ fetchQuotes: vi.fn() }));
import { fetchQuotes } from "@/lib/quotes";
import { computeNetGreeks } from "./snapshots";

const mockedFetch = vi.mocked(fetchQuotes);

function leg(over: Partial<Leg>): Leg {
  return {
    id: "l", strategy_id: "s", occ_symbol: "O:SPY261002C00073500",
    option_type: "call", strike_cents: 73500, expiry: "2026-10-02",
    side: "short", qty: 1, entry_price_cents: 100, exit_price_cents: null,
    entry_at: "2026-09-20T00:00:00Z", exit_at: null, fees_cents: 0,
    entry_delta: null, entry_gamma: null, entry_theta: null, entry_vega: null,
    entry_iv: null, exit_delta: null, exit_gamma: null, exit_theta: null,
    exit_vega: null, exit_iv: null, external_open_fill_id: null,
    external_close_fill_id: null, created_at: "2026-09-20T00:00:00Z",
    ...over,
  } as Leg;
}

function quote(delta: number, price = 25, theta = -0.05): Quote {
  return {
    price, delta, gamma: 0.002, theta, vega: 0.1, iv: 0.15,
    asOf: "2026-09-23T20:00:00.000Z", greeksMissing: false,
    underlyingPrice: 739,
  };
}

const SHORT_735 = "O:SPY261002C00073500";
const LONG_740 = "O:SPY261002C00074000";

// A bear call spread: short the lower strike, long the higher one.
const bearCallSpread = [
  leg({ occ_symbol: SHORT_735, side: "short", strike_cents: 73500 }),
  leg({ occ_symbol: LONG_740, side: "long", strike_cents: 74000 }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeNetGreeks — bear call spread", () => {
  it("nets the two legs against each other instead of adding them", async () => {
    // Both deep ITM: deltas nearly equal, so the spread is nearly delta-neutral.
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.98)],
        [LONG_740, quote(0.97)],
      ]),
      misses: new Map(),
      creditsRemaining: 98,
    });

    const snap = await computeNetGreeks(bearCallSpread);

    // (-0.98 + 0.97) * 100 = -1
    expect(snap.netGreeks.delta).toBeCloseTo(-1, 6);
    expect(Math.abs(snap.netGreeks.delta)).toBeLessThan(25);
  });

  it("scales with contract quantity", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.55)],
        [LONG_740, quote(0.40)],
      ]),
      misses: new Map(),
      creditsRemaining: 98,
    });

    const tenLots = bearCallSpread.map((l) => ({ ...l, qty: 10 }));
    const snap = await computeNetGreeks(tenLots);

    // (-0.55 + 0.40) * 100 * 10 = -150
    expect(snap.netGreeks.delta).toBeCloseTo(-150, 6);
  });

  // This is the shape of a wrong-looking number: one leg silently absent
  // leaves the other leg's delta unopposed, inflating the net several-fold.
  it("reports a partial fill loudly rather than returning a lopsided net", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([[SHORT_735, quote(0.88)]]),
      misses: new Map([[LONG_740, "No data for this contract"]]),
      creditsRemaining: 99,
    });

    const twoLots = bearCallSpread.map((l) => ({ ...l, qty: 2 }));
    const snap = await computeNetGreeks(twoLots);

    // -0.88 * 100 * 2 = -176 — an unopposed short leg, not a real spread delta.
    expect(snap.netGreeks.delta).toBeCloseTo(-176, 6);
    const failed = snap.perLeg.find((l) => l.error);
    expect(failed?.occ_symbol).toBe(LONG_740);
  });

  it("excludes legs whose Greeks were not supplied", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.98)],
        [LONG_740, { ...quote(0), greeksMissing: true }],
      ]),
      misses: new Map(),
      creditsRemaining: 98,
    });

    const snap = await computeNetGreeks(bearCallSpread);
    expect(snap.netGreeks.delta).toBeCloseTo(-98, 6);
    expect(snap.perLeg.find((l) => l.occ_symbol === LONG_740)?.greeks_missing).toBe(true);
  });

  // The real position that prompted this: QQQ ~739, strikes straddling spot.
  it("reports a per-unit delta inside [-1, 1] for a 20-lot vertical", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.6231, 12.41)],
        [LONG_740, quote(0.535, 9.23)],
      ]),
      misses: new Map(),
      creditsRemaining: 96,
    });

    const twentyLots = bearCallSpread.map((l) => ({ ...l, qty: 20 }));
    const snap = await computeNetGreeks(twentyLots);

    // Dollars per 1-point move across the whole position.
    expect(snap.netGreeks.delta).toBeCloseTo(-176.2, 4);
    // The same thing divided back down by the 20-lot size: a plain option delta.
    expect(snap.rawDelta).toBeCloseTo(-0.0881, 6);
    expect(snap.rawDelta!).toBeGreaterThan(-1);
    expect(snap.rawDelta!).toBeLessThan(1);
    expect(snap.legCount).toBe(2);
  });

  it("keeps the shape of a ratio spread rather than flattening it", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.60)],
        [LONG_740, quote(0.40)],
      ]),
      misses: new Map(),
      creditsRemaining: 96,
    });

    // 2 short x 4 long reduces to 1x2, not 1x1.
    const ratio = [
      { ...bearCallSpread[0], qty: 2 },
      { ...bearCallSpread[1], qty: 4 },
    ];
    const snap = await computeNetGreeks(ratio);

    // (-0.60 * 1) + (0.40 * 2) = 0.20
    expect(snap.rawDelta).toBeCloseTo(0.2, 6);
  });

  it("gives a single contract its own delta back unchanged", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([[SHORT_735, quote(0.6231)]]),
      misses: new Map(),
      creditsRemaining: 99,
    });
    const snap = await computeNetGreeks([leg({ side: "long", qty: 1 })]);
    expect(snap.rawDelta).toBeCloseTo(0.6231, 6);
  });

  it("nets theta across legs and reports it per unit", async () => {
    // A short call decays in your favour, the long one against you.
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, quote(0.6231, 12.41, -0.2434)],
        [LONG_740, quote(0.535, 9.23, -0.2231)],
      ]),
      misses: new Map(),
      creditsRemaining: 96,
    });

    const twentyLots = bearCallSpread.map((l) => ({ ...l, qty: 20 }));
    const snap = await computeNetGreeks(twentyLots);

    // short: -(-0.2434) * 2000 = +486.8 ; long: -0.2231 * 2000 = -446.2
    expect(snap.netGreeks.theta).toBeCloseTo(40.6, 4);
    expect(snap.rawTheta).toBeCloseTo(0.0203, 6);

    const shortLeg = snap.perLeg.find((l) => l.occ_symbol === SHORT_735)!;
    const longLeg = snap.perLeg.find((l) => l.occ_symbol === LONG_740)!;
    expect(shortLeg.theta_contribution).toBeCloseTo(486.8, 4);
    expect(longLeg.theta_contribution).toBeCloseTo(-446.2, 4);
    // Net theta positive: a credit spread collects decay.
    expect(snap.netGreeks.theta).toBeGreaterThan(0);
  });

  it("carries the underlying spot through from whichever leg supplied it", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([
        [SHORT_735, { ...quote(0.6231), underlyingPrice: null }],
        [LONG_740, quote(0.535)],
      ]),
      misses: new Map(),
      creditsRemaining: 96,
    });
    const snap = await computeNetGreeks(bearCallSpread);
    expect(snap.underlyingPrice).toBe(739);
  });

  it("signs a short leg negative and a long leg positive", async () => {
    mockedFetch.mockResolvedValue({
      quotes: new Map([[SHORT_735, quote(0.5)]]),
      misses: new Map(),
      creditsRemaining: 99,
    });
    const shortOnly = await computeNetGreeks([leg({ side: "short" })]);
    expect(shortOnly.netGreeks.delta).toBeCloseTo(-50, 6);

    const longOnly = await computeNetGreeks([leg({ side: "long" })]);
    expect(longOnly.netGreeks.delta).toBeCloseTo(50, 6);
  });
});
