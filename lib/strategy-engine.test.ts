import { describe, expect, it } from "vitest";
import { bsmPrice } from "./pricing";
import { buildStructures } from "./strategy-catalog";
import { buildStrategyContext, evaluateStrategies, fetchPlan, gateIdeas } from "./strategy-engine";
import { evaluateStructure, chainIndex, type ChainContract } from "./strategy-economics";
import { STRATEGY_FAMILIES } from "./strategy-rules";
import { SaveStrategySetInputSchema } from "./schemas";
import type { OhlcvBar } from "./technicals";
import type { TickerReport } from "./types";
import fixture from "@/tests/fixtures/ticker-report-aapl.json";

const AS_OF = "2026-11-09T15:00:00Z";
const FRONT = "2026-11-20"; // 11 DTE
const SHORT = "2026-11-11"; // 2 DTE
const BACK = "2026-12-04";
const SPOT = 10000;

/** ~60 sessions oscillating around $100 with ~20% realized vol. */
function bars(): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  let c = 10000;
  for (let i = 0; i < 60; i++) {
    const r = Math.sin(i * 1.7) * 0.0125;
    const o = Math.round(c * (1 + r * 0.2));
    c = Math.round(c * (1 + r));
    const d = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    out.push({ date: d, open_cents: o, high_cents: Math.max(o, c) + 60, low_cents: Math.min(o, c) - 60, close_cents: c, volume: 1e6 });
  }
  return out;
}

/** A BSM-priced chain: mid at `iv`, quoted ±3% around mid (min 2¢ wide). */
function chain(iv: number, expiries = [FRONT, SHORT, BACK]): ChainContract[] {
  const out: ChainContract[] = [];
  for (const expiry of expiries) {
    const T = Math.max((Date.parse(`${expiry}T21:00:00Z`) - Date.parse(AS_OF)) / (365 * 86_400_000), 1e-4);
    for (let k = 8500; k <= 11500; k += 250) {
      for (const type of ["call", "put"] as const) {
        const mid = bsmPrice({ S: SPOT, K: k, r: 0.04, T, sigma: iv, type });
        const half = Math.max(1, mid * 0.03);
        out.push({
          expiry,
          strike_cents: k,
          type,
          bid_cents: Math.max(0, Math.floor(mid - half)),
          ask_cents: Math.ceil(mid + half),
          iv,
          open_interest: 1000,
          quoted_at: AS_OF,
        });
      }
    }
  }
  return out;
}

const report = (over: Partial<TickerReport> = {}): TickerReport =>
  ({
    ...(fixture as unknown as TickerReport),
    as_of: "2026-11-09T14:00:00Z",
    snapshot: { ...(fixture as unknown as TickerReport).snapshot, price_cents: SPOT, iv: 0.4, iv_rank: 70 },
    ...over,
  }) as TickerReport;

const ctxFor = (r: TickerReport | null, horizons: ("short" | "long")[] = ["long"]) =>
  buildStrategyContext({ symbol: "AAPL", asOf: AS_OF, horizons, bars: bars(), report: r, referencePriceCents: SPOT });

describe("buildStrategyContext", () => {
  it("reads the regime from the latest report and levels from stored bars", () => {
    const ctx = ctxFor(report());
    expect(ctx.report?.ratings).toEqual({ trend: "up", momentum: "positive", volatility: "normal", risk: "moderate" });
    expect(ctx.selections.long?.bias).toBe("bullish");
    expect(ctx.selections.long?.iv_regime).toBe("rich");
    expect(ctx.hv20).toBeGreaterThan(0.1);
    expect(ctx.gap_cents).toBeGreaterThan(0);
    expect(ctx.supports_cents.every((s) => s < SPOT)).toBe(true);
    expect(ctx.resistances_cents.every((s) => s > SPOT)).toBe(true);
  });

  it("warns and stays neutral without a report", () => {
    const ctx = ctxFor(null);
    expect(ctx.selections.long?.bias).toBe("neutral");
    expect(ctx.warnings.join(" ")).toMatch(/No ticker report/);
  });

  it("counts days to earnings and pushes short strikes outside the expected move", () => {
    const ctx = ctxFor(report({ next_earnings_date: "2026-11-16" }));
    expect(ctx.days_to_earnings).toBe(7);
    expect(ctx.selections.long?.earnings_mode).toBe("spans_earnings");
    const plan = fetchPlan(ctx)[0];
    expect(plan.min_short_distance_cents).toBeGreaterThan(0);
    expect(plan.back_month).not.toBeNull(); // calendar across the event
  });

  it("plans a bounded strike band per horizon", () => {
    const plan = fetchPlan(ctxFor(report(), ["short", "long"]));
    expect(plan.map((p) => p.horizon)).toEqual(["short", "long"]);
    for (const p of plan) {
      expect(p.strike_band_cents[0]).toBeLessThan(SPOT);
      expect(p.strike_band_cents[1]).toBeGreaterThan(SPOT);
      expect(p.strike_band_cents[0]).toBeGreaterThanOrEqual(SPOT * 0.7);
    }
  });
});

describe("buildStructures", () => {
  const base = {
    chain: chain(0.3),
    spot_cents: SPOT,
    supports: [9600, 9300],
    resistances: [10400, 10700],
    atr_cents: 150,
    min_short_distance_cents: 0,
    bias: "neutral" as const,
    front_expiries: [FRONT],
  };

  it("anchors short puts at or below support and short calls at or above resistance", () => {
    const tol = 0.25 * 150;
    const s = buildStructures({ ...base, families: ["put_credit_spread", "call_credit_spread", "iron_condor"] });
    expect(s.length).toBeGreaterThan(20);
    for (const st of s) {
      for (const l of st.legs.filter((l) => l.side === "short")) {
        if (l.type === "put") expect(l.strike_cents).toBeLessThanOrEqual(9600 + tol);
        else expect(l.strike_cents).toBeGreaterThanOrEqual(10400 - tol);
      }
    }
  });

  it("keeps short strikes outside the expected move into earnings", () => {
    const s = buildStructures({ ...base, min_short_distance_cents: 900, families: ["put_credit_spread", "call_credit_spread"] });
    for (const st of s) for (const l of st.legs.filter((l) => l.side === "short")) {
      expect(Math.abs(l.strike_cents - SPOT)).toBeGreaterThanOrEqual(900);
    }
  });

  it("builds every family without undefined risk", () => {
    const idx = chainIndex(base.chain);
    const ctx = { spot_cents: SPOT, as_of: AS_OF, hv20: 0.2, iv_fallback: 0.3, gap_cents: 150, account_value_cents: 1e8 };
    for (const family of STRATEGY_FAMILIES) {
      const s = buildStructures({ ...base, families: [family], bias: "bullish", front_expiries: [FRONT] });
      expect(s.length, family).toBeGreaterThan(0);
      for (const st of s) {
        const e = evaluateStructure(st, idx, ctx);
        expect(e.failures, `${family} ${JSON.stringify(st.legs)}`).not.toContain("unbounded_risk");
        expect(e.failures).not.toContain("missing_contract");
      }
    }
  });

  it("broken-wing butterflies always have the wider wing away from spot", () => {
    for (const st of buildStructures({ ...base, families: ["put_broken_wing_butterfly"] })) {
      const [near, body, far] = st.legs;
      expect(body.ratio).toBe(2);
      expect(near.strike_cents).toBeGreaterThan(body.strike_cents);
      expect(body.strike_cents - far.strike_cents).toBeGreaterThan(near.strike_cents - body.strike_cents);
    }
  });
});

describe("evaluateStrategies", () => {
  const input = (iv: number, horizons: ("short" | "long")[] = ["long"]) => ({
    horizons,
    chain: chain(iv),
    account_value_cents: 1_000_000,
    as_of: AS_OF,
  });

  it("finds ranked, strategy-diverse premium-selling ideas when IV is rich versus realized", () => {
    const ctx = ctxFor(report());
    const run = evaluateStrategies(input(0.4), ctx);
    expect(run.evaluated).toBeGreaterThan(50);
    expect(run.top.length).toBeGreaterThan(0);
    expect(run.top.length).toBeLessThanOrEqual(3);
    expect(new Set(run.top.map((e) => e.structure.family)).size).toBe(run.top.length);
    for (const e of run.top) {
      expect(e.passed).toBe(true);
      expect(e.horizon).toBe("long");
      expect(e.economics!.ev_realized_cents).toBeGreaterThan(0);
      expect(e.economics!.max_loss_cents).toBeLessThanOrEqual(3.25 * e.economics!.max_gain_cents!);
    }
    // Ranked by expected return on risk.
    const scores = run.top.map((e) => e.score!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("answers no compliant setup when IV is cheap and premium selling has no edge", () => {
    const ctx = ctxFor(report({ snapshot: { ...report().snapshot, iv: 0.08, iv_rank: 5 } }));
    const run = evaluateStrategies(input(0.08), ctx);
    expect(run.rejected.negative_expectancy).toBeGreaterThan(0);
    for (const e of run.top) expect(e.economics!.ev_realized_cents).toBeGreaterThan(0);
  });

  it("only builds front expiries inside the requested horizons", () => {
    const ctx = ctxFor(report(), ["short"]);
    const run = evaluateStrategies(input(0.4, ["short"]), ctx);
    for (const e of [...run.top, ...run.near_misses]) expect(e.front_expiry).toBe(SHORT);
  });
});

describe("gateIdeas", () => {
  it("stores the server's numbers and rejects repeated families", () => {
    const ctx = ctxFor(report());
    const run = evaluateStrategies({ horizons: ["long"], chain: chain(0.4), account_value_cents: 1_000_000, as_of: AS_OF }, ctx);
    const best = run.top[0];
    const set = SaveStrategySetInputSchema.parse({
      symbol: "AAPL",
      as_of: AS_OF,
      horizons: ["long"],
      reference_price_cents: SPOT,
      reference_at: AS_OF,
      account_value_cents: 1_000_000,
      chain: chain(0.4),
      ideas: [{ family: best.structure.family, legs: best.structure.legs, rationale: "Edge: IV over realized." }],
    });
    const ok = gateIdeas(set, ctx);
    expect(ok.problems).toEqual([]);
    expect(ok.ideas[0].economics.max_loss_cents).toBe(best.economics!.max_loss_cents);
    expect(ok.ideas[0].payoff.length).toBeGreaterThan(10);

    const dup = gateIdeas({ ...set, ideas: [set.ideas[0], set.ideas[0]] }, ctx);
    expect(dup.problems.join(" ")).toMatch(/strategy-diverse/);
  });
});
