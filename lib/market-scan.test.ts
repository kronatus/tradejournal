import { describe, expect, it } from "vitest";
import { computeScan, SCAN_LIMITS } from "./market-scan";
import type { OhlcvBar } from "./technicals";
import type { UniverseEntry } from "./universe";

const DAYS = 40;
const dates = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
});
const SCAN = dates[DAYS - 1];

function member(
  symbol: string,
  sector: string,
  sub: string,
  shares: number | null = null
): UniverseEntry {
  return {
    symbol,
    name: `${symbol} Inc`,
    sector,
    sub_industry: sub,
    indexes: ["SPX"],
    role: "member",
    shares_outstanding: shares,
    shares_as_of: null,
  };
}

type Tweak = Partial<Pick<OhlcvBar, "open_cents" | "high_cents" | "low_cents" | "close_cents" | "volume">>;

/**
 * A quiet random-walk-ish series (deterministic) with optional overrides on
 * the last bar. Daily moves are ±~0.4%, volume ~1M, so planted events stand out.
 */
function series(seed: number, opts: { last?: (prev: OhlcvBar) => Tweak; drift?: number } = {}) {
  const out: OhlcvBar[] = [];
  let close = 10000 + seed * 100;
  for (let i = 0; i < DAYS; i++) {
    const r = 0.004 * Math.sin(i * 1.7 + seed) + (opts.drift ?? 0);
    const prev = close;
    close = Math.round(prev * (1 + r));
    out.push({
      date: dates[i],
      open_cents: prev,
      high_cents: Math.max(prev, close) + 10,
      low_cents: Math.min(prev, close) - 10,
      close_cents: close,
      volume: 1_000_000 + ((i * 7919 + seed * 104729) % 50_000),
    });
  }
  if (opts.last) {
    const prev = out[DAYS - 2];
    out[DAYS - 1] = { ...out[DAYS - 1], ...opts.last(prev) };
  }
  return out;
}

const TECH = "Information Technology";
const ENERGY = "Energy";

function fixture() {
  const universe: UniverseEntry[] = [
    member("AAA", TECH, "Semiconductors"),
    member("BBB", TECH, "Semiconductors"),
    member("CCC", TECH, "Software"),
    member("DDD", TECH, "Software"),
    member("EEE", ENERGY, "Oil & Gas"),
    member("FFF", ENERGY, "Oil & Gas"),
    member("GGG", ENERGY, "Oil & Gas"),
    member("HHH", ENERGY, "Pipelines"),
    member("ZZZ", ENERGY, "Pipelines"), // no bar on scan date
    { ...member("SPY", "", ""), sector: null, sub_industry: null, role: "index", indexes: [], name: "SPDR S&P 500" },
    { ...member("XLK", TECH, ""), sub_industry: null, role: "sector_etf", indexes: [] },
  ];
  const bars: Record<string, OhlcvBar[]> = {
    // 5x volume, ordinary price move
    AAA: series(1, { last: () => ({ volume: 5_000_000 }) }),
    // +8% close: a large z-score and far from its sector
    BBB: series(2, {
      last: (p) => ({
        open_cents: p.close_cents,
        close_cents: Math.round(p.close_cents * 1.08),
        high_cents: Math.round(p.close_cents * 1.081),
      }),
    }),
    // 5% gap up at the open
    CCC: series(3, {
      last: (p) => ({
        open_cents: Math.round(p.close_cents * 1.05),
        close_cents: Math.round(p.close_cents * 1.05),
        high_cents: Math.round(p.close_cents * 1.055),
        low_cents: Math.round(p.close_cents * 1.045),
      }),
    }),
    // 3x volume with the close unchanged: quiet accumulation
    DDD: series(4, {
      last: (p) => ({
        open_cents: p.close_cents,
        close_cents: p.close_cents,
        high_cents: p.close_cents + 5,
        low_cents: p.close_cents - 5,
        volume: 3_000_000,
      }),
    }),
    // steady uptrend → streak, new high
    EEE: series(5, { drift: 0.006 }),
    FFF: series(6),
    GGG: series(7),
    HHH: series(8),
    ZZZ: series(9).slice(0, DAYS - 1),
    SPY: series(10),
    XLK: series(11),
  };
  return { universe, bars };
}

describe("computeScan", () => {
  it("covers only members with a bar on the scan date", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    expect(d.meta.universe_members).toBe(9);
    expect(d.meta.covered).toBe(8);
    expect(d.meta.history_days).toBe(DAYS);
    expect(d.scan_date).toBe(SCAN);
  });

  it("flags each planted anomaly with the right reason code", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    const flags = (s: string) => d.anomalies.find((a) => a.symbol === s)?.flags ?? [];
    expect(flags("AAA")).toContain("REL_VOL");
    expect(flags("BBB")).toContain("RET_Z");
    expect(flags("BBB")).toContain("NEW_HIGH");
    expect(flags("CCC")).toContain("GAP");
    expect(flags("DDD")).toEqual(expect.arrayContaining(["REL_VOL", "QUIET_ACCUMULATION"]));
    expect(flags("EEE")).toEqual(expect.arrayContaining(["STREAK", "NEW_HIGH"]));
    // A quiet name raises nothing.
    expect(flags("GGG")).toEqual([]);
  });

  it("ranks anomalies by score, highest first", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    const scores = d.anomalies.map((a) => a.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("caps every list so the digest size is bounded", () => {
    const universe: UniverseEntry[] = [];
    const bars: Record<string, OhlcvBar[]> = {};
    for (let i = 0; i < 80; i++) {
      const sym = `S${i}`;
      universe.push(member(sym, i % 2 ? TECH : ENERGY, `Ind${i % 20}`));
      bars[sym] = series(i, { last: () => ({ volume: 9_000_000 }) });
    }
    const d = computeScan(bars, universe, SCAN);
    expect(d.anomalies.length).toBe(SCAN_LIMITS.anomalies);
    expect(d.movers.up.length).toBeLessThanOrEqual(SCAN_LIMITS.movers);
    expect(d.movers.down.length).toBeLessThanOrEqual(SCAN_LIMITS.movers);
    expect(d.industries.leaders.length).toBeLessThanOrEqual(SCAN_LIMITS.industries);
    expect(JSON.stringify(d).length).toBeLessThan(20_000);
  });

  it("equal-weights without share counts and cap-weights with them", () => {
    const { universe, bars } = fixture();
    expect(computeScan(bars, universe, SCAN).weighting).toBe("equal");

    const withShares = universe.map((e) =>
      e.role === "member" ? { ...e, shares_outstanding: e.symbol === "BBB" ? 1e9 : 1e6 } : e
    );
    const d = computeScan(bars, withShares, SCAN);
    expect(d.weighting).toBe("cap");
    // BBB dominates the cap-weighted universe, so it is the top contributor and
    // pulls the weighted return well above the equal-weighted one.
    expect(d.movers.up[0].symbol).toBe("BBB");
    expect(d.breadth.universe_ret_1d!).toBeGreaterThan(d.breadth.equal_weight_ret_1d!);
  });

  it("contributions sum to the weighted universe return", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    const all = [...d.movers.up, ...d.movers.down];
    // With 8 members and a cap of 10 per side, every mover is listed.
    const sumBps = all.reduce((s, m) => s + m.contribution_bps, 0);
    expect(sumBps / 100).toBeCloseTo(d.breadth.universe_ret_1d!, 1);
  });

  it("aggregates sectors with ranks, breadth and the sector ETF", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    expect(d.sectors.map((s) => s.rank_5d)).toEqual([1, 2]);
    const tech = d.sectors.find((s) => s.sector === TECH)!;
    expect(tech.members).toBe(4);
    expect(tech.etf?.symbol).toBe("XLK");
    expect(tech.rank_change_5d).not.toBeNull();
    expect(tech.breadth_pct).toBeGreaterThanOrEqual(0);
    expect(d.indices.map((i) => i.symbol)).toEqual(["SPY"]);
  });

  it("needs three members before an industry is ranked", () => {
    const { universe, bars } = fixture();
    const d = computeScan(bars, universe, SCAN);
    const names = [...d.industries.leaders, ...d.industries.laggards].map((r) => r.sub_industry);
    expect(names).toContain("Oil & Gas");
    expect(names).not.toContain("Software");
  });

  it("ignores bars after the scan date so past days can be recomputed", () => {
    const { universe, bars } = fixture();
    const earlier = dates[DAYS - 2];
    const d = computeScan(bars, universe, earlier);
    expect(d.scan_date).toBe(earlier);
    expect(d.meta.covered).toBe(9); // ZZZ has a bar that day
    expect(d.anomalies.find((a) => a.symbol === "AAA")).toBeUndefined();
  });

  it("does not claim new highs without enough history", () => {
    const { universe, bars } = fixture();
    const short = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v.slice(-10)]));
    const d = computeScan(short, universe, SCAN);
    expect(d.breadth.new_highs).toBe(0);
    expect(d.breadth.pct_above_sma20).toBeNull();
  });
});
