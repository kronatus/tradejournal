import { describe, expect, it } from "vitest";
import {
  articleAgeHours,
  formatCompact,
  formatPct,
  formatRating,
  groupTickers,
  normalizeSymbol,
  ratingTone,
  reportFreshness,
  UNSORTED,
} from "./research";

const t = (symbol: string, sector: string | null, industry: string | null, setup: string | null = null) => ({
  symbol,
  sector,
  industry,
  setup,
});

const TICKERS = [
  t("NVDA", "Information Technology", "Semiconductors", "Breakout"),
  t("AMD", "Information Technology", "Semiconductors", "Pullback"),
  t("MSFT", "Information Technology", "Software", "Breakout"),
  t("XOM", "Energy", "Oil & Gas", null),
  t("NEWCO", null, null, null),
];

describe("groupTickers", () => {
  it("nests sector › industry with counts and leaf items", () => {
    const g = groupTickers(TICKERS, ["sector", "industry"]);
    expect(g.map((x) => x.label)).toEqual(["Energy", "Information Technology", UNSORTED]);
    const it = g[1];
    expect(it.count).toBe(3);
    expect(it.items).toEqual([]);
    expect(it.children.map((c) => [c.label, c.count])).toEqual([
      ["Semiconductors", 2],
      ["Software", 1],
    ]);
    expect(it.children[0].items.map((x) => x.symbol)).toEqual(["NVDA", "AMD"]);
    expect(it.children[0].path).toEqual(["Information Technology", "Semiconductors"]);
  });

  it("puts missing values under Unsorted, always last", () => {
    const g = groupTickers(TICKERS, ["sector"]);
    expect(g[g.length - 1]).toMatchObject({ label: UNSORTED, count: 1 });
    expect(g[g.length - 1].items[0].symbol).toBe("NEWCO");
  });

  it("pivots by changing the level order", () => {
    const g = groupTickers(TICKERS, ["setup", "sector"]);
    expect(g.map((x) => x.label)).toEqual(["Breakout", "Pullback", UNSORTED]);
    expect(g[0].children.map((c) => c.label)).toEqual(["Information Technology"]);
    expect(g[0].children[0].items.map((x) => x.symbol)).toEqual(["NVDA", "MSFT"]);
  });

  it("returns nothing for no levels or no tickers", () => {
    expect(groupTickers(TICKERS, [])).toEqual([]);
    expect(groupTickers([], ["sector"])).toEqual([]);
  });
});

describe("reportFreshness", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  it("buckets by age", () => {
    expect(reportFreshness("2026-11-08T01:00:00Z", now)).toBe("fresh");
    expect(reportFreshness("2026-11-06T12:00:00Z", now)).toBe("aging");
    expect(reportFreshness("2026-11-01T12:00:00Z", now)).toBe("stale");
    expect(reportFreshness(null, now)).toBe("none");
    expect(reportFreshness("garbage", now)).toBe("none");
  });
});

describe("normalizeSymbol", () => {
  it("upper-cases and trims valid symbols", () => {
    expect(normalizeSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeSymbol("brk.b")).toBe("BRK.B");
  });
  it("rejects junk", () => {
    expect(normalizeSymbol("")).toBeNull();
    expect(normalizeSymbol("1ABC")).toBeNull();
    expect(normalizeSymbol("TOO LONG SYMBOL")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats percent with sign", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-0.5)).toBe("-0.50%");
    expect(formatPct(null)).toBe("—");
  });
  it("formats compact numbers", () => {
    expect(formatCompact(4_975_243_992_000)).toBe("5.0T");
    expect(formatCompact(44_703_764)).toBe("44.7M");
    expect(formatCompact(512)).toBe("512");
    expect(formatCompact(null)).toBe("—");
  });
  it("formats and tones ratings", () => {
    expect(formatRating("strong_up")).toBe("Strong up");
    expect(ratingTone("strong_up")).toBe("gain");
    expect(ratingTone("very_high")).toBe("loss");
    expect(ratingTone("unknown")).toBe("neutral");
  });
  it("measures article age against the report time", () => {
    expect(articleAgeHours("2026-11-07T12:00:00Z", "2026-11-08T12:00:00Z")).toBe(24);
    expect(articleAgeHours("bad", "2026-11-08T12:00:00Z")).toBeNull();
  });
});
