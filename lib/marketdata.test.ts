import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMarketdataQuotes, fetchMarketdataSpot } from "./marketdata";

const TOKEN = "test-token";
const OCC = "O:SPY260529C00075500";
const STANDARD = "SPY260529C00755000";

// Marketdata returns COLUMN-oriented JSON: one array per field, index-aligned.
function okBody(over: Record<string, unknown> = {}) {
  return {
    s: "ok",
    optionSymbol: [STANDARD],
    updated: [1790000000],
    bid: [13.01],
    ask: [13.42],
    mid: [13.215],
    last: [99.99], // deliberately wrong: mid must win
    iv: [0.133142],
    delta: [0.563302],
    gamma: [0.014059],
    theta: [-0.243408],
    vega: [0.828369],
    ...over,
  };
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const res = {
    ok: (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: "",
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    json: async () => body,
  };
  return vi.fn().mockResolvedValue(res);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMarketdataQuotes", () => {
  it("requests the standard OCC form, not the storage form", async () => {
    const f = mockFetch(okBody());
    vi.stubGlobal("fetch", f);

    await fetchMarketdataQuotes([OCC], TOKEN);

    const url = f.mock.calls[0][0] as string;
    expect(url).toContain(`/options/quotes/${STANDARD}/`);
    expect(url).not.toContain("O:");
    expect(url).not.toContain("00075500");
  });

  it("marks from the midpoint, never from last", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody()));
    const { quotes } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.get(OCC)!.price).toBeCloseTo(13.215, 6);
  });

  it("falls back to the bid/ask average when mid is absent", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody({ mid: [null] })));
    const { quotes } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.get(OCC)!.price).toBeCloseTo((13.01 + 13.42) / 2, 6);
  });

  it("keys results by the storage symbol the caller passed in", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody()));
    const { quotes } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.has(OCC)).toBe(true);
    expect(quotes.has(STANDARD)).toBe(false);
  });

  it("carries Greeks and the provider timestamp through", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody()));
    const { quotes } = await fetchMarketdataQuotes([OCC], TOKEN);
    const q = quotes.get(OCC)!;
    expect(q.delta).toBeCloseTo(0.563302, 6);
    expect(q.theta).toBeCloseTo(-0.243408, 6);
    expect(q.iv).toBeCloseTo(0.133142, 6);
    expect(q.greeksMissing).toBe(false);
    // Preserved, not replaced with now() — the free feed is delayed.
    expect(q.asOf).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it("flags absent Greeks instead of reporting them as zero", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody({ delta: [null], gamma: [null], theta: [null], vega: [null] })));
    const { quotes } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.get(OCC)!.greeksMissing).toBe(true);
  });

  it("keeps a legitimately zero mark rather than dropping the contract", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody({ mid: [0], bid: [0], ask: [0], last: [0] })));
    const { quotes, misses } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.get(OCC)!.price).toBe(0);
    expect(misses.size).toBe(0);
  });

  it("reports no_data as a miss rather than a silent absence", async () => {
    vi.stubGlobal("fetch", mockFetch({ s: "no_data" }));
    const { quotes, misses } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(quotes.size).toBe(0);
    expect(misses.get(OCC)).toMatch(/No data/i);
  });

  it("surfaces remaining daily credits", async () => {
    vi.stubGlobal("fetch", mockFetch(okBody(), { headers: { "x-api-ratelimit-remaining": "87" } }));
    const { creditsRemaining } = await fetchMarketdataQuotes([OCC], TOKEN);
    expect(creditsRemaining).toBe(87);
  });

  it("throws on an unrecognised payload rather than inventing Greeks", async () => {
    vi.stubGlobal("fetch", mockFetch({ totally: "unexpected" }));
    await expect(fetchMarketdataQuotes([OCC], TOKEN)).rejects.toThrow(
      /Unexpected Marketdata response/
    );
  });

  it("throws a fatal error on a rejected token", async () => {
    vi.stubGlobal("fetch", mockFetch({}, { status: 401 }));
    await expect(fetchMarketdataQuotes([OCC], TOKEN)).rejects.toThrow(/token/i);
  });

  it("throws a fatal error when credits are exhausted", async () => {
    vi.stubGlobal("fetch", mockFetch({}, { status: 402 }));
    await expect(fetchMarketdataQuotes([OCC], TOKEN)).rejects.toThrow(/credits/i);
  });

  it("refuses a malformed symbol instead of sending it upstream", async () => {
    const f = mockFetch(okBody());
    vi.stubGlobal("fetch", f);
    const { quotes, misses } = await fetchMarketdataQuotes(["SPY260529C00755000"], TOKEN);
    expect(quotes.size).toBe(0);
    expect(misses.size).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("spends one credit per contract, deduplicating repeats", async () => {
    const f = mockFetch(okBody());
    vi.stubGlobal("fetch", f);
    await fetchMarketdataQuotes([OCC, OCC], TOKEN);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("makes no request for an empty symbol list", async () => {
    const f = mockFetch(okBody());
    vi.stubGlobal("fetch", f);
    const { quotes } = await fetchMarketdataQuotes([], TOKEN);
    expect(quotes.size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("fetchMarketdataSpot", () => {
  it("returns the last price", async () => {
    vi.stubGlobal("fetch", mockFetch({ s: "ok", symbol: ["SPY"], last: [761.64] }));
    await expect(fetchMarketdataSpot("spy", TOKEN)).resolves.toBeCloseTo(761.64, 4);
  });

  it("throws when the symbol has no data", async () => {
    vi.stubGlobal("fetch", mockFetch({ s: "no_data" }));
    await expect(fetchMarketdataSpot("ZZZZ", TOKEN)).rejects.toThrow(/No spot price/);
  });
});
