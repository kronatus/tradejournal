import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Leg } from "./types";

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

function quote(delta: number, price = 25) {
  return {
    price, delta, gamma: 0.002, theta: -0.05, vega: 0.1, iv: 0.15,
    asOf: "2026-09-23T20:00:00.000Z", greeksMissing: false,
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
