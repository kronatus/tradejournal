import { describe, expect, it } from "vitest";
import { horizonForDte, ivRegime, selectFamilies, type RegimeInput } from "./strategy-rules";

const base: RegimeInput = {
  trend: "sideways",
  momentum: "neutral",
  volatility: "normal",
  risk: "moderate",
  iv: 0.3,
  ivRank: 40,
  hv20: 0.28,
  daysToEarnings: null,
  horizon: "long",
};

describe("ivRegime", () => {
  it("is rich when IV exceeds realized by 15% or IV rank ≥ 50", () => {
    expect(ivRegime(0.35, 10, 0.3).regime).toBe("rich");
    expect(ivRegime(0.3, 55, 0.3).regime).toBe("rich");
  });
  it("is cheap when IV is under 90% of realized and rank < 25", () => {
    expect(ivRegime(0.25, 20, 0.3).regime).toBe("cheap");
    expect(ivRegime(0.25, 30, 0.3).regime).toBe("fair");
  });
  it("is unknown without IV/HV or rank", () => {
    expect(ivRegime(null, null, 0.3).regime).toBe("unknown");
    expect(ivRegime(0.3, null, null).regime).toBe("unknown");
  });
  it("reports the IV/HV ratio", () => {
    expect(ivRegime(0.36, null, 0.3).ivToHv).toBe(1.2);
  });
});

describe("selectFamilies", () => {
  it("sells premium on both sides when neutral", () => {
    const s = selectFamilies(base);
    expect(s.bias).toBe("neutral");
    expect(s.families.slice(0, 2)).toEqual(["iron_condor", "iron_butterfly"]);
    expect(s.families).not.toContain("call_debit_spread");
  });

  it("leans bullish on an uptrend with positive momentum", () => {
    const s = selectFamilies({ ...base, trend: "up", momentum: "positive" });
    expect(s.bias).toBe("bullish");
    expect(s.bias_score).toBe(1.5);
    expect(s.families[0]).toBe("put_credit_spread");
    // Not strong enough, IV fair: no debit spreads.
    expect(s.families).not.toContain("call_debit_spread");
  });

  it("allows a debit spread when the setup demands direction", () => {
    const s = selectFamilies({ ...base, trend: "strong_up", momentum: "positive", ivRank: 30, iv: 0.3, hv20: 0.3 });
    expect(s.families).toContain("call_debit_spread");
  });

  it("never buys debit spreads when IV is rich", () => {
    const s = selectFamilies({ ...base, trend: "strong_down", momentum: "weak", ivRank: 80 });
    expect(s.bias).toBe("bearish");
    expect(s.iv_regime).toBe("rich");
    expect(s.families).not.toContain("put_debit_spread");
    expect(s.families[0]).toBe("call_credit_spread");
  });

  it("opens debit and time spreads when IV is cheap", () => {
    const s = selectFamilies({ ...base, trend: "up", momentum: "positive", iv: 0.2, ivRank: 10, hv20: 0.3 });
    expect(s.iv_regime).toBe("cheap");
    expect(s.families).toContain("call_debit_spread");
    expect(s.families).toContain("calendar");
  });

  it("restricts to IV-crush structures when earnings fall inside the window", () => {
    const s = selectFamilies({ ...base, trend: "strong_up", momentum: "strong", iv: 0.2, ivRank: 10, daysToEarnings: 9 });
    expect(s.earnings_mode).toBe("spans_earnings");
    expect(s.families).not.toContain("call_debit_spread");
    expect(s.families).not.toContain("diagonal");
    expect(s.families).toContain("calendar");
  });

  it("ignores earnings beyond the horizon", () => {
    expect(selectFamilies({ ...base, horizon: "short", daysToEarnings: 9 }).earnings_mode).toBe("none");
  });

  it("drops naked-put-side structures when risk is very high", () => {
    const s = selectFamilies({ ...base, trend: "up", momentum: "strong", risk: "very_high" });
    expect(s.families).not.toContain("cash_secured_put");
    expect(s.families).not.toContain("jade_lizard");
    expect(s.families).not.toContain("put_ratio_spread");
    expect(s.families).toContain("put_credit_spread");
  });

  it("treats missing ratings as neutral and says so", () => {
    const s = selectFamilies({ ...base, trend: null, momentum: null });
    expect(s.bias).toBe("neutral");
    expect(s.notes.join(" ")).toMatch(/No trend\/momentum/);
  });
});

describe("horizonForDte", () => {
  it("maps 0–3 to short, 4–21 to long, beyond to none", () => {
    expect(horizonForDte(0)).toBe("short");
    expect(horizonForDte(3)).toBe("short");
    expect(horizonForDte(4)).toBe("long");
    expect(horizonForDte(21)).toBe("long");
    expect(horizonForDte(22)).toBeNull();
  });
});
