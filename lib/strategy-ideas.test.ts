import { describe, expect, it } from "vitest";
import {
  describeLeg,
  ideaToTradePrefill,
  parseSandboxLegs,
  sandboxHref,
  setStaleness,
  strategyKindFor,
  tradeHref,
} from "./strategy-ideas";
import type { StrategyIdea, StrategySet } from "./types";

const idea = {
  rank: 1,
  family: "put_credit_spread",
  label: "Put credit spread",
  name: null,
  horizon: "long",
  front_expiry: "2026-11-20",
  dte: 11,
  legs: [
    { side: "short", ratio: 1, type: "put", strike_cents: 9750, expiry: "2026-11-20", occ_symbol: null, bid_cents: 152, ask_cents: 158, fill_cents: 152, iv: 0.31, open_interest: 900, spread_pct: 3.9 },
    { side: "long", ratio: 1, type: "put", strike_cents: 9500, expiry: "2026-11-20", occ_symbol: null, bid_cents: 80, ask_cents: 86, fill_cents: 86, iv: 0.33, open_interest: 700, spread_pct: 7.2 },
  ],
  economics: { sigma_implied: 0.32 },
  sizing: { qty: 3, capital_at_risk_cents: 55000, pct_of_account: 27.5 },
  rationale: "Sell premium below support.",
  exit_plan: "Take half at 50% of max profit.",
} as unknown as StrategyIdea;

const set = (over: Partial<StrategySet> = {}): StrategySet =>
  ({
    id: "set-1",
    reference_price_cents: 10000,
    reference_at: "2026-11-09T15:00:00Z",
    horizons: ["long"],
    regime: { atr_cents: 200 },
    ideas: [idea],
    ...over,
  }) as StrategySet;

describe("setStaleness", () => {
  const t0 = Date.parse("2026-11-09T15:00:00Z");

  it("is fresh within the horizon's limit and the drift band", () => {
    expect(setStaleness(set(), t0 + 60 * 60_000, 10050)).toEqual({ stale: false, reasons: [] });
  });

  it("goes stale after a day for 4–21 DTE ideas and after 30 minutes for 0–3 DTE", () => {
    expect(setStaleness(set(), t0 + 25 * 3_600_000, null).stale).toBe(true);
    const short = set({ ideas: [{ ...idea, horizon: "short" }] });
    const s = setStaleness(short, t0 + 45 * 60_000, null);
    expect(s.stale).toBe(true);
    expect(s.reasons[0]).toMatch(/45 min ago \(limit 30 min\)/);
  });

  it("goes stale when the price drifts more than half an ATR", () => {
    const s = setStaleness(set(), t0 + 60_000, 10150);
    expect(s.stale).toBe(true);
    expect(s.reasons[0]).toMatch(/0.8 ATR/);
  });
});

describe("leg text and kinds", () => {
  it("describes legs at natural prices", () => {
    expect(describeLeg(idea.legs[0])).toBe("Sell 1 Nov 20 $97.50 put @ $1.52");
    expect(describeLeg(idea.legs[1], 3)).toBe("Buy 3 Nov 20 $95.00 put @ $0.86");
  });

  it("maps families onto journal strategy kinds", () => {
    expect(strategyKindFor({ family: "call_credit_spread" })).toBe("vertical");
    expect(strategyKindFor({ family: "iron_condor" })).toBe("iron_condor");
    expect(strategyKindFor({ family: "jade_lizard" })).toBe("custom");
  });
});

describe("hand-off links", () => {
  it("prefills the trade form at the sized quantity", () => {
    const p = ideaToTradePrefill(idea, "AAPL");
    expect(p.strategy_kind).toBe("vertical");
    expect(p.legs).toEqual([
      { side: "sell", optionType: "P", strike: "97.50", expiry: "2026-11-20", quantity: 3, entry_price_cents: 152 },
      { side: "buy", optionType: "P", strike: "95.00", expiry: "2026-11-20", quantity: 3, entry_price_cents: 86 },
    ]);
    expect(p.notes).toMatch(/Sell premium below support/);
    expect(tradeHref("set-1", 1)).toBe("/trades/new?set=set-1&idea=1");
  });

  it("round-trips sandbox legs and drops malformed ones", () => {
    const href = sandboxHref(idea, "AAPL", 10012);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("symbol")).toBe("AAPL");
    expect(params.get("spot")).toBe("100.12");
    expect(parseSandboxLegs(params.get("legs"))).toEqual([
      { optionType: "put", side: "short", qty: 3, strike: 97.5, expiry: "2026-11-20", entryPrice: 1.52, iv: 0.31 },
      { optionType: "put", side: "long", qty: 3, strike: 95, expiry: "2026-11-20", entryPrice: 0.86, iv: 0.33 },
    ]);
    expect(parseSandboxLegs("x:s:1:97.5:2026-11-20:1.5:0.3,p:l:0:95:2026-11-20:1:0.3")).toEqual([]);
    expect(parseSandboxLegs(null)).toEqual([]);
  });
});
