import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  exchangeDate,
  groupBars,
  planBackfillDates,
  planIngestDates,
  runIngest,
  type IngestDeps,
} from "./market-ingest";
import { EodRateLimitError, fetchGroupedDaily, type GroupedDailyResult } from "./market-data/eod";
import type { MarketBar } from "./types";
import type { UniverseEntry } from "./universe";

describe("dates", () => {
  it("uses the New York calendar day", () => {
    // 02:00 UTC on Nov 7 is still Nov 6 in New York.
    expect(exchangeDate(new Date("2026-11-07T02:00:00Z"))).toBe("2026-11-06");
    expect(exchangeDate(new Date("2026-11-07T15:00:00Z"))).toBe("2026-11-07");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -3)).toBe("2026-10-30");
  });
});

describe("planIngestDates", () => {
  it("lists weekdays after the last stored session, oldest first", () => {
    // Thu Nov 5 stored; today Tue Nov 10 → Fri, Mon, Tue
    expect(planIngestDates("2026-11-05", "2026-11-10", { maxDays: 10 })).toEqual([
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  it("caps the run at maxDays, keeping the oldest gaps first", () => {
    expect(planIngestDates("2026-10-01", "2026-11-10", { maxDays: 2 })).toEqual([
      "2026-10-02",
      "2026-10-05",
    ]);
  });

  it("is empty when already current", () => {
    expect(planIngestDates("2026-11-10", "2026-11-10", { maxDays: 4 })).toEqual([]);
  });

  it("bootstraps from N weekdays back when nothing is stored", () => {
    // Sunday Nov 8 → the last 3 weekdays are Wed–Fri
    expect(planIngestDates(null, "2026-11-08", { maxDays: 4, bootstrapDays: 3 })).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });
});

describe("planBackfillDates", () => {
  it("skips stored sessions and weekends, oldest first, capped", () => {
    const stored = new Set(["2026-11-03"]);
    expect(planBackfillDates("2026-11-02", "2026-11-10", stored, 3)).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-05",
    ]);
  });
});

describe("groupBars", () => {
  it("groups by symbol and sorts oldest first", () => {
    const b = (date: string, symbol: string) =>
      ({ date, symbol, open_cents: 1, high_cents: 1, low_cents: 1, close_cents: 1, vwap_cents: null, volume: 1 });
    const g = groupBars([b("2026-01-02", "A"), b("2026-01-01", "A"), b("2026-01-01", "B")]);
    expect(g.A.map((x) => x.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(g.B).toHaveLength(1);
  });
});

const UNIVERSE: UniverseEntry[] = ["AAA", "BBB"].map((symbol) => ({
  symbol,
  name: symbol,
  sector: "Energy",
  sub_industry: "Oil",
  indexes: ["SPX"],
  role: "member",
  shares_outstanding: null,
  shares_as_of: null,
}));

function bar(date: string, symbol: string, close = 10000): MarketBar {
  return { date, symbol, open_cents: close, high_cents: close, low_cents: close, close_cents: close, vwap_cents: null, volume: 1000 };
}

function memoryDeps(days: Record<string, GroupedDailyResult | Error>, stored: MarketBar[] = []) {
  const bars = [...stored];
  const scans: string[] = [];
  const deps: IngestDeps = {
    fetchDay: vi.fn(async (date: string) => {
      const d = days[date];
      if (d instanceof Error) throw d;
      return d ?? { status: "empty", date };
    }),
    lastStoredDate: async () => (bars.length ? bars.map((b) => b.date).sort().at(-1)! : null),
    storedDates: async (from, to) => new Set(bars.map((b) => b.date).filter((d) => d >= from && d <= to)),
    latestScanDate: async () => scans.sort().at(-1) ?? null,
    keepSymbols: async () => new Set(["AAA", "BBB"]),
    upsertBars: async (b) => void bars.push(...b),
    loadBars: async (from, to) => bars.filter((b) => b.date >= from && b.date <= to),
    saveScan: async (row) => void scans.push(row.scan_date),
  };
  return { deps, bars, scans };
}

describe("runIngest", () => {
  const now = new Date("2026-11-10T16:00:00Z"); // Tue Nov 10, New York

  it("stores only kept symbols, skips holidays, and scans new sessions", async () => {
    const { deps, bars, scans } = memoryDeps(
      {
        "2026-11-06": { status: "ok", date: "2026-11-06", bars: [bar("2026-11-06", "AAA"), bar("2026-11-06", "ZZZ")] },
        "2026-11-09": { status: "empty", date: "2026-11-09" }, // pretend holiday
        "2026-11-10": { status: "ok", date: "2026-11-10", bars: [bar("2026-11-10", "AAA", 10100), bar("2026-11-10", "BBB")] },
      },
      [bar("2026-11-05", "AAA"), bar("2026-11-05", "BBB")]
    );
    const r = await runIngest(deps, UNIVERSE, { now });
    expect(r.planned).toEqual(["2026-11-06", "2026-11-09", "2026-11-10"]);
    expect(r.ingested).toEqual([
      { date: "2026-11-06", bars: 1 },
      { date: "2026-11-10", bars: 2 },
    ]);
    expect(r.empty).toEqual(["2026-11-09"]);
    expect(bars.some((b) => b.symbol === "ZZZ")).toBe(false);
    expect(r.scanned).toEqual(["2026-11-06", "2026-11-10"]);
    expect(scans).toHaveLength(2);
  });

  it("computes a missing scan for the latest stored session", async () => {
    const { deps } = memoryDeps({}, [bar("2026-11-09", "AAA"), bar("2026-11-09", "BBB")]);
    const r = await runIngest(deps, UNIVERSE, { now });
    expect(r.ingested).toEqual([]);
    expect(r.scanned).toEqual(["2026-11-09"]);
  });

  it("stops at an unpublished today without error", async () => {
    const { deps } = memoryDeps({}, [bar("2026-11-09", "AAA")]);
    const r = await runIngest(deps, UNIVERSE, { now });
    expect(r.planned).toEqual(["2026-11-10"]);
    expect(r.empty).toEqual(["2026-11-10"]);
    expect(r.ingested).toEqual([]);
  });

  it("stops early on a rate limit and keeps what it stored", async () => {
    const { deps } = memoryDeps(
      {
        "2026-11-06": { status: "ok", date: "2026-11-06", bars: [bar("2026-11-06", "AAA")] },
        "2026-11-09": new EodRateLimitError(),
      },
      [bar("2026-11-05", "AAA")]
    );
    const r = await runIngest(deps, UNIVERSE, { now });
    expect(r.ingested.map((d) => d.date)).toEqual(["2026-11-06"]);
    expect(r.stoppedEarly).toMatch(/rate limit/);
    expect(deps.fetchDay).toHaveBeenCalledTimes(2);
  });

  it("backfills history behind existing data and rescans the latest session", async () => {
    const { deps, scans } = memoryDeps(
      {
        "2026-11-02": { status: "ok", date: "2026-11-02", bars: [bar("2026-11-02", "AAA")] },
        "2026-11-03": { status: "empty", date: "2026-11-03" },
      },
      [bar("2026-11-04", "AAA"), bar("2026-11-05", "AAA"), bar("2026-11-06", "AAA"), bar("2026-11-09", "AAA"), bar("2026-11-10", "AAA")]
    );
    await deps.saveScan({ scan_date: "2026-11-10", weighting: "equal", digest: {} });
    const r = await runIngest(deps, UNIVERSE, { now, fromDate: "2026-11-02", maxDays: 4, rescanLatest: true });
    expect(r.planned).toEqual(["2026-11-02", "2026-11-03"]);
    expect(r.ingested.map((d) => d.date)).toEqual(["2026-11-02"]);
    expect(r.scanned).toEqual(["2026-11-02", "2026-11-10"]);
    expect(scans.filter((d) => d === "2026-11-10")).toHaveLength(2);
  });

  it("propagates unexpected provider errors", async () => {
    const { deps } = memoryDeps({ "2026-11-10": new Error("boom") }, [bar("2026-11-09", "AAA")]);
    await expect(runIngest(deps, UNIVERSE, { now })).rejects.toThrow("boom");
  });
});

describe("fetchGroupedDaily", () => {
  const json = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("converts dollars to integer cents and drops non-positive prices", async () => {
    const r = await fetchGroupedDaily("2026-11-06", {
      apiKey: "k",
      fetchImpl: json({
        status: "OK",
        resultsCount: 2,
        results: [
          { T: "AAPL", o: 338.3, h: 345.79, l: 338.3, c: 342.36, v: 44703764, vw: 342.105, t: 0 },
          { T: "BAD", o: 0, h: 0, l: 0, c: 0, v: 0, t: 0 },
        ],
      }),
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.bars).toEqual([
      {
        date: "2026-11-06",
        symbol: "AAPL",
        open_cents: 33830,
        high_cents: 34579,
        low_cents: 33830,
        close_cents: 34236,
        vwap_cents: 34211,
        volume: 44703764,
      },
    ]);
  });

  it("treats a zero-result day as empty", async () => {
    const r = await fetchGroupedDaily("2026-11-08", { apiKey: "k", fetchImpl: json({ status: "OK", resultsCount: 0 }) });
    expect(r).toEqual({ status: "empty", date: "2026-11-08" });
  });

  it("throws on rate limits, HTTP errors and unrecognised payloads", async () => {
    await expect(fetchGroupedDaily("2026-11-06", { apiKey: "k", fetchImpl: json({}, 429) })).rejects.toBeInstanceOf(
      EodRateLimitError
    );
    await expect(
      fetchGroupedDaily("2026-11-06", { apiKey: "k", fetchImpl: json({ status: "ERROR", error: "Unknown API Key" }, 401) })
    ).rejects.toThrow("Unknown API Key");
    await expect(
      fetchGroupedDaily("2026-11-06", { apiKey: "k", fetchImpl: json({ status: "WEIRD", resultsCount: 1 }) })
    ).rejects.toThrow(/Unexpected/);
    await expect(fetchGroupedDaily("11/06/2026", { apiKey: "k", fetchImpl: json({}) })).rejects.toThrow(/Invalid date/);
  });
});
