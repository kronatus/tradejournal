/**
 * The market scan: turns end-of-day bars for the whole universe (S&P 500 +
 * Nasdaq-100, ~520 names) into a compact digest of what moved the market.
 *
 * This is the mechanical half of the market sweep. It runs in code so Claude
 * never has to read 520 quotes: the `get_market_scan` MCP tool hands Claude
 * this digest (a few thousand tokens), and Claude spends its effort on the
 * handful of names worth a deep dive.
 *
 * Pure: no I/O, no clock. Returns/distances are percent units (1.5 = 1.5%),
 * prices are integer cents, contributions are basis points of the universe's
 * move. Every list is capped so the digest's size is bounded by construction.
 */

import { dailyReturns, pctChange, sma, stdev, streak, type OhlcvBar } from "./technicals";
import type { UniverseEntry } from "./universe";

export const SCAN_THRESHOLDS = {
  /** Today's volume vs the 20 prior sessions. */
  relVolume: 2.5,
  /** 1-day return vs the stock's own 20-day return stdev. */
  returnZ: 2.5,
  /** |open − prev close| / prev close, percent. */
  gapPct: 3,
  /** Divergence from sector: |ret − sector ret| ≥ sigma × sector dispersion … */
  divergenceSigma: 2.5,
  /** … and at least this many percentage points. */
  divergenceMinPct: 2,
  /** "Quiet accumulation": heavy volume with almost no price move. */
  quietRelVolume: 2,
  quietMaxMovePct: 0.5,
  /** Consecutive closes in one direction. */
  streakDays: 5,
  /** Minimum prior bars before new-high / new-low flags are meaningful. */
  minHighLowWindow: 20,
  /** Shares coverage needed to cap-weight; below it the scan equal-weights. */
  capWeightCoverage: 0.9,
} as const;

export const SCAN_LIMITS = {
  anomalies: 25,
  movers: 10,
  industries: 5,
  minIndustryMembers: 3,
} as const;

export type AnomalyFlag =
  | "REL_VOL"
  | "RET_Z"
  | "GAP"
  | "NEW_HIGH"
  | "NEW_LOW"
  | "SECTOR_DIVERGENCE"
  | "QUIET_ACCUMULATION"
  | "STREAK";

export type IndexRow = {
  symbol: string;
  name: string;
  close_cents: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_20d: number | null;
};

export type SectorRow = {
  sector: string;
  members: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_20d: number | null;
  /** Share of members that closed up, percent. */
  breadth_pct: number;
  /** Sector dollar volume vs its 20-day average. */
  rel_volume: number | null;
  /** 1 = strongest 5-day return. */
  rank_5d: number;
  /** Positive = moved up the ranking vs 5 sessions ago (rotation in). */
  rank_change_5d: number | null;
  etf: { symbol: string; ret_1d: number | null; ret_5d: number | null } | null;
};

export type IndustryRow = {
  sub_industry: string;
  sector: string;
  members: number;
  ret_1d: number | null;
  ret_5d: number | null;
  rel_volume: number | null;
};

export type MoverRow = {
  symbol: string;
  name: string;
  sector: string;
  ret_1d: number;
  contribution_bps: number;
  rel_volume: number | null;
};

export type AnomalyRow = {
  symbol: string;
  name: string;
  sector: string;
  sub_industry: string | null;
  close_cents: number;
  ret_1d: number | null;
  ret_5d: number | null;
  rel_volume: number | null;
  return_z: number | null;
  gap_pct: number | null;
  streak: number;
  flags: AnomalyFlag[];
  score: number;
};

export type ScanDigest = {
  scan_date: string;
  weighting: "cap" | "equal";
  meta: {
    universe_members: number;
    covered: number;
    /** Most bars any member had up to scan_date (the scan's lookback). */
    history_days: number;
    /** Prior sessions behind NEW_HIGH / NEW_LOW (e.g. 60 = a 3-month high). */
    high_low_window_days: number;
    thresholds: typeof SCAN_THRESHOLDS;
  };
  breadth: {
    advancers: number;
    decliners: number;
    unchanged: number;
    pct_above_sma20: number | null;
    pct_above_sma50: number | null;
    new_highs: number;
    new_lows: number;
    /** Weighted (cap or equal, per `weighting`) universe return. */
    universe_ret_1d: number | null;
    equal_weight_ret_1d: number | null;
  };
  indices: IndexRow[];
  sectors: SectorRow[];
  industries: { leaders: IndustryRow[]; laggards: IndustryRow[] };
  movers: { up: MoverRow[]; down: MoverRow[] };
  anomalies: AnomalyRow[];
};

type Stats = {
  entry: UniverseEntry;
  bars: OhlcvBar[];
  close: number;
  ret1d: number | null;
  ret5d: number | null;
  ret20d: number | null;
  ret5dPrev: number | null;
  relVol: number | null;
  dollarVol: number;
  avgDollarVol: number | null;
  z: number | null;
  gap: number | null;
  newHigh: boolean;
  newLow: boolean;
  aboveSma20: boolean | null;
  aboveSma50: boolean | null;
  streak: number;
  weight: number;
};

const r2 = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

function symbolStats(entry: UniverseEntry, bars: OhlcvBar[]): Omit<Stats, "weight"> {
  const closes = bars.map((b) => b.close_cents);
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;

  const prior = bars.slice(-21, -1);
  const avgVol = prior.length === 20 ? prior.reduce((s, b) => s + b.volume, 0) / 20 : null;
  const avgDollarVol =
    prior.length === 20
      ? prior.reduce((s, b) => s + b.volume * b.close_cents, 0) / 20
      : null;

  // z-score of today's return against the 20 returns before it.
  const rets = dailyReturns(closes);
  const todayRet = rets.length ? rets[rets.length - 1] : null;
  const priorRets = rets.slice(-21, -1);
  const sd = priorRets.length === 20 ? stdev(priorRets) : null;
  const z = todayRet !== null && sd && sd > 0 ? todayRet / sd : null;

  const window = bars.slice(0, -1).slice(-252);
  const enough = window.length >= SCAN_THRESHOLDS.minHighLowWindow;
  const priorHigh = enough ? Math.max(...window.map((b) => b.high_cents)) : null;
  const priorLow = enough ? Math.min(...window.map((b) => b.low_cents)) : null;

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);

  return {
    entry,
    bars,
    close: last.close_cents,
    ret1d: pctChange(closes, 1),
    ret5d: pctChange(closes, 5),
    ret20d: pctChange(closes, 20),
    ret5dPrev: closes.length > 10 ? pctChange(closes.slice(0, -5), 5) : null,
    relVol: avgVol && avgVol > 0 ? last.volume / avgVol : null,
    dollarVol: last.volume * last.close_cents,
    avgDollarVol,
    z,
    gap: prev && prev.close_cents > 0 ? (last.open_cents / prev.close_cents - 1) * 100 : null,
    newHigh: priorHigh !== null && last.high_cents > priorHigh,
    newLow: priorLow !== null && last.low_cents < priorLow,
    aboveSma20: s20 === null ? null : last.close_cents > s20,
    aboveSma50: s50 === null ? null : last.close_cents > s50,
    streak: streak(closes),
  };
}

/** Weighted mean of `value` over items, skipping nulls; null if nothing left. */
function wmean<T>(items: T[], value: (t: T) => number | null, weight: (t: T) => number) {
  let num = 0;
  let den = 0;
  for (const it of items) {
    const v = value(it);
    const w = weight(it);
    if (v === null || !Number.isFinite(v) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function pctOf(items: Stats[], pred: (s: Stats) => boolean | null): number | null {
  const known = items.filter((s) => pred(s) !== null);
  if (!known.length) return null;
  return r1((known.filter((s) => pred(s)).length / known.length) * 100);
}

function relVolume(items: Stats[]): number | null {
  const withAvg = items.filter((s) => s.avgDollarVol !== null && s.avgDollarVol > 0);
  if (!withAvg.length) return null;
  const today = withAvg.reduce((s, x) => s + x.dollarVol, 0);
  const avg = withAvg.reduce((s, x) => s + (x.avgDollarVol as number), 0);
  return r2(today / avg);
}

/** Dense 1-based ranking by a value, descending; nulls rank last. */
function rankBy<T>(items: T[], value: (t: T) => number | null): Map<T, number> {
  const sorted = [...items].sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
  return new Map(sorted.map((t, i) => [t, i + 1]));
}

/**
 * Compute the digest for `scanDate`. Bars after scanDate are ignored, so a past
 * day can be recomputed from the same table. Symbols with no bar on scanDate
 * are treated as not covered (halted, delisted, or missing from the feed).
 */
export function computeScan(
  barsBySymbol: Record<string, OhlcvBar[]>,
  universe: readonly UniverseEntry[],
  scanDate: string
): ScanDigest {
  const T = SCAN_THRESHOLDS;
  const covered: Omit<Stats, "weight">[] = [];
  const etfs = new Map<string, Omit<Stats, "weight">>();
  let historyDays = 0;
  let windowDays = 0;

  for (const entry of universe) {
    const all = barsBySymbol[entry.symbol];
    if (!all?.length) continue;
    const bars = all.filter((b) => b.date <= scanDate);
    if (!bars.length || bars[bars.length - 1].date !== scanDate) continue;
    const stats = symbolStats(entry, bars);
    if (entry.role === "member") {
      covered.push(stats);
      historyDays = Math.max(historyDays, bars.length);
      windowDays = Math.max(windowDays, Math.min(bars.length - 1, 252));
    } else {
      etfs.set(entry.symbol, stats);
    }
  }

  // Cap-weight only when share counts cover nearly everyone; a member missing
  // shares then gets the median cap so it neither dominates nor vanishes.
  const caps = covered
    .filter((s) => s.entry.shares_outstanding)
    .map((s) => (s.entry.shares_outstanding as number) * s.close);
  const capMode = covered.length > 0 && caps.length / covered.length >= T.capWeightCoverage;
  const medianCap = caps.length ? [...caps].sort((a, b) => a - b)[Math.floor(caps.length / 2)] : 1;
  const stats: Stats[] = covered.map((s) => ({
    ...s,
    weight: capMode
      ? s.entry.shares_outstanding
        ? s.entry.shares_outstanding * s.close
        : medianCap
      : 1,
  }));
  const W = (s: Stats) => s.weight;
  const totalWeight = stats.reduce((sum, s) => sum + s.weight, 0);

  // --- breadth ------------------------------------------------------------
  const breadth = {
    advancers: stats.filter((s) => (s.ret1d ?? 0) > 0).length,
    decliners: stats.filter((s) => (s.ret1d ?? 0) < 0).length,
    unchanged: stats.filter((s) => s.ret1d === 0 || s.ret1d === null).length,
    pct_above_sma20: pctOf(stats, (s) => s.aboveSma20),
    pct_above_sma50: pctOf(stats, (s) => s.aboveSma50),
    new_highs: stats.filter((s) => s.newHigh).length,
    new_lows: stats.filter((s) => s.newLow).length,
    universe_ret_1d: r2(wmean(stats, (s) => s.ret1d, W)),
    equal_weight_ret_1d: r2(wmean(stats, (s) => s.ret1d, () => 1)),
  };

  // --- index proxies --------------------------------------------------------
  const INDEX_ORDER = ["SPY", "QQQ", "IWM", "DIA"];
  const indexRank = (s: string) => (INDEX_ORDER.indexOf(s) + 1 || INDEX_ORDER.length + 1);
  const indices: IndexRow[] = universe
    .filter((e) => e.role === "index" && etfs.has(e.symbol))
    .sort((a, b) => indexRank(a.symbol) - indexRank(b.symbol) || a.symbol.localeCompare(b.symbol))
    .map((e) => {
      const s = etfs.get(e.symbol)!;
      return {
        symbol: e.symbol,
        name: e.name,
        close_cents: s.close,
        ret_1d: r2(s.ret1d),
        ret_5d: r2(s.ret5d),
        ret_20d: r2(s.ret20d),
      };
    });

  // --- sectors --------------------------------------------------------------
  const bySector = new Map<string, Stats[]>();
  for (const s of stats) {
    const k = s.entry.sector ?? "Unclassified";
    bySector.set(k, [...(bySector.get(k) ?? []), s]);
  }
  const sectorEtf = new Map(
    universe.filter((e) => e.role === "sector_etf" && e.sector).map((e) => [e.sector as string, e.symbol])
  );
  type SectorAgg = { sector: string; items: Stats[]; ret5d: number | null; ret5dPrev: number | null };
  const sectorAggs: SectorAgg[] = [...bySector.entries()].map(([sector, items]) => ({
    sector,
    items,
    ret5d: wmean(items, (s) => s.ret5d, W),
    ret5dPrev: wmean(items, (s) => s.ret5dPrev, W),
  }));
  const rankNow = rankBy(sectorAggs, (a) => a.ret5d);
  const havePrev = sectorAggs.some((a) => a.ret5dPrev !== null);
  const rankPrev = rankBy(sectorAggs, (a) => a.ret5dPrev);
  const sectorRet1d = new Map<string, number | null>();
  const sectors: SectorRow[] = sectorAggs
    .map((a) => {
      const ret1d = wmean(a.items, (s) => s.ret1d, W);
      sectorRet1d.set(a.sector, ret1d);
      const etfSym = sectorEtf.get(a.sector);
      const etf = etfSym ? etfs.get(etfSym) : undefined;
      return {
        sector: a.sector,
        members: a.items.length,
        ret_1d: r2(ret1d),
        ret_5d: r2(a.ret5d),
        ret_20d: r2(wmean(a.items, (s) => s.ret20d, W)),
        breadth_pct: r1(
          (a.items.filter((s) => (s.ret1d ?? 0) > 0).length / a.items.length) * 100
        ),
        rel_volume: relVolume(a.items),
        rank_5d: rankNow.get(a)!,
        rank_change_5d: havePrev ? rankPrev.get(a)! - rankNow.get(a)! : null,
        etf: etf && etfSym ? { symbol: etfSym, ret_1d: r2(etf.ret1d), ret_5d: r2(etf.ret5d) } : null,
      };
    })
    .sort((a, b) => a.rank_5d - b.rank_5d);

  // --- industries -----------------------------------------------------------
  const byIndustry = new Map<string, Stats[]>();
  for (const s of stats) {
    if (!s.entry.sub_industry) continue;
    byIndustry.set(s.entry.sub_industry, [...(byIndustry.get(s.entry.sub_industry) ?? []), s]);
  }
  const industryRows: IndustryRow[] = [...byIndustry.entries()]
    .filter(([, items]) => items.length >= SCAN_LIMITS.minIndustryMembers)
    .map(([sub, items]) => ({
      sub_industry: sub,
      sector: items[0].entry.sector ?? "Unclassified",
      members: items.length,
      ret_1d: r2(wmean(items, (s) => s.ret1d, W)),
      ret_5d: r2(wmean(items, (s) => s.ret5d, W)),
      rel_volume: relVolume(items),
    }))
    .filter((r) => r.ret_5d !== null)
    .sort((a, b) => (b.ret_5d as number) - (a.ret_5d as number));
  const industries = {
    leaders: industryRows.slice(0, SCAN_LIMITS.industries),
    laggards: industryRows.slice(-SCAN_LIMITS.industries).reverse(),
  };

  // --- movers (contribution to the universe's move) -------------------------
  const contrib = stats
    .filter((s) => s.ret1d !== null && totalWeight > 0)
    .map((s) => ({
      s,
      bps: (s.weight / totalWeight) * (s.ret1d as number) * 100,
    }));
  const toMover = ({ s, bps }: { s: Stats; bps: number }): MoverRow => ({
    symbol: s.entry.symbol,
    name: s.entry.name,
    sector: s.entry.sector ?? "Unclassified",
    ret_1d: r2(s.ret1d) as number,
    contribution_bps: r1(bps),
    rel_volume: r2(s.relVol),
  });
  const movers = {
    up: contrib
      .filter((c) => c.bps > 0)
      .sort((a, b) => b.bps - a.bps)
      .slice(0, SCAN_LIMITS.movers)
      .map(toMover),
    down: contrib
      .filter((c) => c.bps < 0)
      .sort((a, b) => a.bps - b.bps)
      .slice(0, SCAN_LIMITS.movers)
      .map(toMover),
  };

  // --- anomalies ------------------------------------------------------------
  const sectorDispersion = new Map<string, number | null>();
  for (const [sector, items] of bySector) {
    sectorDispersion.set(
      sector,
      stdev(items.map((s) => s.ret1d).filter((v): v is number => v !== null))
    );
  }
  const anomalies: AnomalyRow[] = [];
  for (const s of stats) {
    const flags: AnomalyFlag[] = [];
    let score = 0;
    if (s.relVol !== null && s.relVol >= T.relVolume) {
      flags.push("REL_VOL");
      score += Math.min(s.relVol / T.relVolume, 4);
    }
    if (s.z !== null && Math.abs(s.z) >= T.returnZ) {
      flags.push("RET_Z");
      score += Math.min(Math.abs(s.z) / T.returnZ, 4);
    }
    if (s.gap !== null && Math.abs(s.gap) >= T.gapPct) {
      flags.push("GAP");
      score += Math.min(Math.abs(s.gap) / T.gapPct, 3);
    }
    if (s.newHigh) {
      flags.push("NEW_HIGH");
      score += 1;
    }
    if (s.newLow) {
      flags.push("NEW_LOW");
      score += 1;
    }
    const sector = s.entry.sector ?? "Unclassified";
    const secRet = sectorRet1d.get(sector);
    const disp = sectorDispersion.get(sector);
    if (s.ret1d !== null && secRet != null && disp) {
      const diff = Math.abs(s.ret1d - secRet);
      if (diff >= T.divergenceSigma * disp && diff >= T.divergenceMinPct) {
        flags.push("SECTOR_DIVERGENCE");
        score += 1;
      }
    }
    if (
      s.relVol !== null &&
      s.relVol >= T.quietRelVolume &&
      s.ret1d !== null &&
      Math.abs(s.ret1d) < T.quietMaxMovePct
    ) {
      flags.push("QUIET_ACCUMULATION");
      score += 1;
    }
    if (Math.abs(s.streak) >= T.streakDays) {
      flags.push("STREAK");
      score += 0.5;
    }
    if (!flags.length) continue;
    anomalies.push({
      symbol: s.entry.symbol,
      name: s.entry.name,
      sector,
      sub_industry: s.entry.sub_industry,
      close_cents: s.close,
      ret_1d: r2(s.ret1d),
      ret_5d: r2(s.ret5d),
      rel_volume: r2(s.relVol),
      return_z: r2(s.z),
      gap_pct: r2(s.gap),
      streak: s.streak,
      flags,
      score: r2(score) as number,
    });
  }
  anomalies.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  return {
    scan_date: scanDate,
    weighting: capMode ? "cap" : "equal",
    meta: {
      universe_members: universe.filter((e) => e.role === "member").length,
      covered: stats.length,
      history_days: historyDays,
      high_low_window_days: windowDays,
      thresholds: SCAN_THRESHOLDS,
    },
    breadth,
    indices,
    sectors,
    industries,
    movers,
    anomalies: anomalies.slice(0, SCAN_LIMITS.anomalies),
  };
}
