import { describe, expect, it } from "vitest";
import { ForgotPasswordInputSchema, ResetPasswordInputSchema } from "./schemas";

describe("ForgotPasswordInputSchema", () => {
  it("accepts and trims a valid email", () => {
    const r = ForgotPasswordInputSchema.parse({ email: "  a@b.co " });
    expect(r.email).toBe("a@b.co");
  });
  it("rejects a malformed email", () => {
    expect(ForgotPasswordInputSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("ResetPasswordInputSchema", () => {
  it("accepts matching passwords", () => {
    expect(
      ResetPasswordInputSchema.safeParse({ password: "secret1", confirm: "secret1" }).success
    ).toBe(true);
  });
  it("rejects mismatch and short passwords", () => {
    expect(
      ResetPasswordInputSchema.safeParse({ password: "secret1", confirm: "secret2" }).success
    ).toBe(false);
    expect(
      ResetPasswordInputSchema.safeParse({ password: "abc", confirm: "abc" }).success
    ).toBe(false);
  });
});

// --- Research & Market Pulse -------------------------------------------------

import fixture from "@/tests/fixtures/ticker-report-aapl.json";
import {
  ArticleSchema,
  MarketSweepInputSchema,
  MassiveGroupedDailySchema,
  TickerReportInputSchema,
  TickerSymbolSchema,
  sweepProblems,
  tickerReportProblems,
} from "./schemas";

describe("TickerReportInputSchema", () => {
  it("accepts a report built from real Robinhood MCP output", () => {
    const r = TickerReportInputSchema.parse(fixture);
    expect(r.symbol).toBe("AAPL"); // normalised
    expect(r.snapshot.market_cap_cents).toBe(497524399200000);
    expect(tickerReportProblems(r)).toEqual([]);
  });

  it("rejects fractional cents", () => {
    const bad = structuredClone(fixture);
    bad.snapshot.price_cents = 342.65;
    expect(TickerReportInputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown technical rating", () => {
    const bad = structuredClone(fixture);
    bad.technicals.trend.rating = "moon";
    expect(TickerReportInputSchema.safeParse(bad).success).toBe(false);
  });

  it("allows at most five articles", () => {
    const bad = structuredClone(fixture);
    bad.articles = Array.from({ length: 6 }, (_, i) => ({
      ...fixture.articles[0],
      url: `https://example.com/${i}`,
    }));
    expect(TickerReportInputSchema.safeParse(bad).success).toBe(false);
  });

  it("flags articles dated after the report and duplicates", () => {
    const r = TickerReportInputSchema.parse({
      ...fixture,
      articles: [
        { ...fixture.articles[0], published_at: "2026-11-09T00:00:00Z" },
        fixture.articles[0],
      ],
    });
    const problems = tickerReportProblems(r);
    expect(problems.some((p) => p.includes("after as_of"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicates"))).toBe(true);
  });
});

describe("ArticleSchema", () => {
  it("only accepts http(s) links", () => {
    const a = fixture.articles[0];
    expect(ArticleSchema.safeParse(a).success).toBe(true);
    expect(ArticleSchema.safeParse({ ...a, url: "javascript:alert(1)" }).success).toBe(false);
    expect(ArticleSchema.safeParse({ ...a, url: "ftp://x.com/a" }).success).toBe(false);
  });
});

describe("TickerSymbolSchema", () => {
  it("normalises and validates", () => {
    expect(TickerSymbolSchema.parse(" brk.b ")).toBe("BRK.B");
    expect(TickerSymbolSchema.safeParse("12AB").success).toBe(false);
  });
});

describe("MarketSweepInputSchema", () => {
  const base = {
    as_of: "2026-11-07T21:00:00Z",
    scan_date: "2026-11-06",
    headline: "Semis lead while defensives lag",
    regime: "rotation",
    summary: "Breadth narrowed as megacap tech carried the tape.",
    highlights: [{ kind: "sector", title: "Semis +3.1%", body: "Volume 1.8x average.", symbols: ["nvda"] }],
    picks: [{ symbol: "amd", direction: "bullish", horizon: "weeks", signal: "REL_VOL + NEW_HIGH", thesis: "Breakout on volume." }],
    trends: [{ title: "Rotation into tech", body: "Rank up 4 places over 5 days.", sectors: ["Information Technology"] }],
  };
  it("accepts a sweep and normalises symbols", () => {
    const r = MarketSweepInputSchema.parse(base);
    expect(r.picks[0].symbol).toBe("AMD");
    expect(r.highlights[0].symbols).toEqual(["NVDA"]);
  });
  it("rejects unknown regimes and too many picks", () => {
    expect(MarketSweepInputSchema.safeParse({ ...base, regime: "bubble" }).success).toBe(false);
    expect(
      MarketSweepInputSchema.safeParse({ ...base, picks: new Array(11).fill(base.picks[0]) }).success
    ).toBe(false);
  });
});

describe("MassiveGroupedDailySchema", () => {
  it("accepts a populated day and an empty (holiday) day", () => {
    expect(
      MassiveGroupedDailySchema.safeParse({
        status: "OK",
        adjusted: true,
        queryCount: 1,
        resultsCount: 1,
        results: [{ T: "AAPL", o: 338.3, h: 345.79, l: 338.3, c: 342.36, v: 44703764, vw: 342.1, t: 1762462800000, n: 600000 }],
      }).success
    ).toBe(true);
    expect(MassiveGroupedDailySchema.safeParse({ status: "OK", resultsCount: 0 }).success).toBe(true);
  });
  it("rejects an unrecognised status", () => {
    expect(MassiveGroupedDailySchema.safeParse({ status: "NOT_AUTHORIZED", resultsCount: 0 }).success).toBe(false);
  });
});

describe("sweep news", () => {
  const headline = {
    title: "Fed holds rates, signals one more cut",
    url: "https://example.com/fed",
    source: "Example Wire",
    published_at: "2026-11-06T19:00:00Z",
    summary: "Yields fell after the statement.",
    impact: "market",
    symbols: ["spy"],
    sectors: ["Financials"],
  };
  const sweep = (news: unknown[]) =>
    MarketSweepInputSchema.parse({
      as_of: "2026-11-07T21:00:00Z",
      headline: "h",
      regime: "neutral",
      summary: "s",
      news,
    });

  it("accepts headlines, normalises symbols and defaults to none", () => {
    expect(sweep([headline]).news[0].symbols).toEqual(["SPY"]);
    expect(sweep([]).news).toEqual([]);
    expect(MarketSweepInputSchema.parse({ as_of: "2026-11-07T21:00:00Z", headline: "h", regime: "neutral", summary: "s" }).news).toEqual([]);
  });

  it("enforces limits, URL scheme and the impact enum", () => {
    expect(() => sweep(new Array(9).fill(headline))).toThrow();
    expect(() => sweep([{ ...headline, url: "javascript:alert(1)" }])).toThrow();
    expect(() => sweep([{ ...headline, impact: "huge" }])).toThrow();
    expect(() => sweep([{ ...headline, symbols: new Array(7).fill("AAPL") }])).toThrow();
  });

  it("rejects stale, future-dated and duplicate headlines", () => {
    expect(sweepProblems(sweep([headline]))).toEqual([]);
    const stale = sweepProblems(sweep([{ ...headline, published_at: "2026-11-05T08:00:00Z" }]));
    expect(stale[0]).toMatch(/older than 36h/);
    const future = sweepProblems(sweep([{ ...headline, published_at: "2026-11-08T12:00:00Z" }]));
    expect(future[0]).toMatch(/after as_of/);
    const dup = sweepProblems(sweep([headline, headline]));
    expect(dup[0]).toMatch(/duplicates/);
  });
});
