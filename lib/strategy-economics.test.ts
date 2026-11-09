import { describe, expect, it } from "vitest";
import {
  calendarDte,
  chainIndex,
  evaluateStructure,
  expectation,
  expiryCloseMs,
  rankAndDiversify,
  type ChainContract,
  type EvalContext,
  type Evaluation,
  type Structure,
  type StructureLeg,
} from "./strategy-economics";
import { bsmPrice } from "./pricing";
import { STRATEGY_RULES } from "./strategy-rules";

const AS_OF = "2026-11-09T15:00:00Z"; // Monday 10:00 New York
const FRONT = "2026-11-20"; // 11 DTE → long horizon
const BACK = "2026-12-18";
const FEE = STRATEGY_RULES.feePerContractCents;
const YEAR_MS = 365 * 86_400_000;

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  spot_cents: 10000,
  as_of: AS_OF,
  hv20: 0.2,
  iv_fallback: 0.3,
  gap_cents: 150,
  account_value_cents: 1_000_000,
  ...over,
});

const c = (
  type: "call" | "put",
  strike: number,
  bid: number | null,
  ask: number | null,
  expiry = FRONT,
  iv: number | null = 0.3
): ChainContract => ({
  expiry,
  strike_cents: strike,
  type,
  bid_cents: bid,
  ask_cents: ask,
  iv,
  open_interest: 500,
  quoted_at: AS_OF,
});

const leg = (side: "long" | "short", type: "call" | "put", strike: number, ratio = 1, expiry = FRONT): StructureLeg => ({
  side,
  type,
  strike_cents: strike,
  ratio,
  expiry,
});

const evalOne = (structure: Structure, chain: ChainContract[], over: Partial<EvalContext> = {}) =>
  evaluateStructure(structure, chainIndex(chain), ctx(over));

const pcs = (legs: StructureLeg[]): Structure => ({ family: "put_credit_spread", name: "PCS", legs });

describe("time helpers", () => {
  it("counts calendar days from the New York date", () => {
    expect(calendarDte(FRONT, AS_OF)).toBe(11);
    // 01:00 UTC on the 10th is still the 9th in New York.
    expect(calendarDte(FRONT, "2026-11-10T01:00:00Z")).toBe(11);
  });
  it("puts the expiry close at 16:00 New York (EST/EDT aware)", () => {
    expect(new Date(expiryCloseMs("2026-11-20")).toISOString()).toBe("2026-11-20T21:00:00.000Z");
    expect(new Date(expiryCloseMs("2026-07-17")).toISOString()).toBe("2026-07-17T20:00:00.000Z");
  });
});

describe("credit spread economics", () => {
  const chain = [c("put", 9500, 200, 210), c("put", 9000, 70, 80)];
  const spread = pcs([leg("short", "put", 9500), leg("long", "put", 9000)]);

  it("prices at natural and computes max gain/loss from the payoff", () => {
    const e = evalOne(spread, chain);
    const econ = e.economics!;
    expect(econ.net_cents).toBe(120); // 2.00 bid − 0.80 ask
    expect(econ.credit).toBe(true);
    expect(econ.max_gain_cents).toBe(12000 - 2 * FEE);
    expect(econ.max_loss_cents).toBe(38000 + 2 * FEE);
    expect(econ.risk_reward).toBeCloseTo(3.17, 2);
    expect(econ.breakevens_cents).toEqual([9380]);
    expect(e.horizon).toBe("long");
    expect(e.dte).toBe(11);
  });

  it("passes the gate at a $1.20 credit on a $5 width", () => {
    const e = evalOne(spread, chain);
    expect(e.failures).toEqual([]);
    expect(e.passed).toBe(true);
    expect(e.economics!.ev_realized_cents).toBeGreaterThan(0);
    expect(e.economics!.pop_realized).toBeGreaterThan(80);
    // Theta-positive: premium seller.
    expect(e.economics!.theta_cents_per_day).toBeGreaterThan(0);
    // 50% of $10,000 / $380.12 per spread.
    expect(e.sizing).toEqual({ qty: 13, capital_at_risk_cents: 13 * 38012, pct_of_account: 49.4 });
  });

  it("fails gate A at a $1.10 credit (ratio 3.55)", () => {
    const e = evalOne(spread, [c("put", 9500, 190, 200), c("put", 9000, 70, 80)]);
    expect(e.economics!.risk_reward).toBeCloseTo(3.55, 2);
    expect(e.failures).toContain("risk_reward");
    expect(e.passed).toBe(false);
  });

  it("fails gate C when one spread risks more than half the account", () => {
    const e = evalOne(spread, chain, { account_value_cents: 50_000 });
    expect(e.failures).toContain("account_cap");
    expect(e.sizing).toBeNull();
  });

  it("fails gate B when realized volatility makes the expectancy negative", () => {
    const e = evalOne(spread, chain, { hv20: 0.9 });
    expect(e.economics!.ev_realized_cents).toBeLessThan(0);
    expect(e.failures).toContain("negative_expectancy");
  });

  it("fails the gap test when a recent-size gap reaches the long strike", () => {
    const e = evalOne(spread, chain, { gap_cents: 1200 });
    expect(e.economics!.gap).toMatchObject({ size_cents: 1200, survives: false });
    expect(e.failures).toContain("gap");
    expect(evalOne(spread, chain, { gap_cents: 300 }).economics!.gap!.survives).toBe(true);
  });

  it("rejects a short leg without a bid and a leg missing from the chain", () => {
    expect(evalOne(spread, [c("put", 9500, null, 10), c("put", 9000, 70, 80)]).failures).toContain("no_bid_on_short");
    expect(evalOne(spread, [c("put", 9500, 200, 210)]).failures).toContain("missing_contract");
  });

  it("rejects expiries outside the horizon windows", () => {
    const far = pcs([leg("short", "put", 9500, 1, BACK), leg("long", "put", 9000, 1, BACK)]);
    const e = evalOne(far, [c("put", 9500, 300, 310, BACK), c("put", 9000, 120, 130, BACK)]);
    expect(e.failures).toContain("outside_horizon");
  });
});

describe("structure shapes", () => {
  it("iron condor: max loss is the wider side's width minus the credit", () => {
    const chain = [c("put", 9000, 60, 70), c("put", 9500, 150, 160), c("call", 10500, 140, 150), c("call", 11000, 50, 60)];
    const e = evalOne(
      {
        family: "iron_condor",
        name: "IC",
        legs: [leg("long", "put", 9000), leg("short", "put", 9500), leg("short", "call", 10500), leg("long", "call", 11000)],
      },
      chain
    );
    const credit = 150 - 70 + 140 - 60; // 160
    expect(e.economics!.net_cents).toBe(credit);
    expect(e.economics!.max_loss_cents).toBe((500 - credit) * 100 + 4 * FEE);
    expect(e.economics!.max_gain_cents).toBe(credit * 100 - 4 * FEE);
    expect(e.economics!.breakevens_cents).toEqual([9500 - credit, 10500 + credit]);
  });

  it("broken-wing butterfly: risk only on the wide side", () => {
    // Long 9900P, short 2× 9600P, long 9100P (300 / 500 wings) for a credit.
    const chain = [c("put", 9900, 300, 310), c("put", 9600, 190, 200), c("put", 9100, 60, 70)];
    const e = evalOne(
      {
        family: "put_broken_wing_butterfly",
        name: "BWB",
        legs: [leg("long", "put", 9900), leg("short", "put", 9600, 2), leg("long", "put", 9100)],
      },
      chain
    );
    const net = -310 + 2 * 190 - 70; // 0 → zero cost
    expect(e.economics!.net_cents).toBe(net);
    // Above 9900 all expire: keep the net minus fees. Max gain at the body: 300 wide.
    expect(e.economics!.max_gain_cents).toBe((300 + net) * 100 - 4 * FEE);
    // Below 9100: 300 − 2×500 + 500 = −200 per share.
    expect(e.economics!.max_loss_cents).toBe((200 - net) * 100 + 4 * FEE);
  });

  it("jade lizard: no upside risk when the credit exceeds the call width", () => {
    const chain = [c("put", 9500, 150, 160), c("call", 10500, 120, 130), c("call", 10700, 30, 40)];
    const e = evalOne(
      {
        family: "jade_lizard",
        name: "JL",
        legs: [leg("short", "put", 9500), leg("short", "call", 10500), leg("long", "call", 10700)],
      },
      chain
    );
    expect(e.economics!.net_cents).toBe(230);
    // Upside floor: 2.30 credit − 2.00 width > 0 → only a downside breakeven.
    expect(e.economics!.breakevens_cents).toEqual([9500 - 230]);
    expect(e.economics!.max_loss_cents).toBe((9500 - 230) * 100 + 3 * FEE);
    expect(e.failures).toContain("risk_reward");
  });

  it("rejects undefined risk: a naked call or a call front-ratio", () => {
    const naked = evalOne({ family: "custom", name: "naked", legs: [leg("short", "call", 10500)] }, [c("call", 10500, 120, 130)]);
    expect(naked.failures).toContain("unbounded_risk");
    const ratio = evalOne(
      { family: "custom", name: "ratio", legs: [leg("long", "call", 10000), leg("short", "call", 10500, 2)] },
      [c("call", 10000, 250, 260), c("call", 10500, 120, 130)]
    );
    expect(ratio.failures).toContain("unbounded_risk");
  });

  it("rejects a structure that is long and short the same contract", () => {
    const e = evalOne(
      { family: "custom", name: "dup", legs: [leg("long", "put", 9500), leg("short", "put", 9500)] },
      [c("put", 9500, 200, 210)]
    );
    expect(e.failures).toEqual(["invalid_structure"]);
  });

  it("calendar: model-valued back month, max loss ≈ the debit", () => {
    const chain = [c("call", 10000, 250, 260), c("call", 10000, 390, 400, BACK, 0.3)];
    const e = evalOne(
      { family: "calendar", name: "Cal", legs: [leg("short", "call", 10000), leg("long", "call", 10000, 1, BACK)] },
      chain
    );
    const econ = e.economics!;
    expect(econ.model_based).toBe(true);
    expect(econ.net_cents).toBe(-150);
    expect(econ.max_loss_cents).toBeGreaterThan(14000);
    expect(econ.max_loss_cents).toBeLessThanOrEqual(15000 + 2 * FEE);
    // Peak at the strike: back call's model value minus the debit.
    const t = (expiryCloseMs(BACK) - expiryCloseMs(FRONT)) / YEAR_MS;
    const peak = bsmPrice({ S: 10000, K: 10000, r: STRATEGY_RULES.riskFreeRate, T: t, sigma: 0.3, type: "call" });
    expect(econ.max_gain_cents! / 100).toBeCloseTo(peak - 150 - (2 * FEE) / 100, 0);
  });
});

describe("expectation", () => {
  it("matches the closed form for a short put (zero-drift lognormal)", () => {
    const K = 9500;
    const credit = 200;
    const t = (expiryCloseMs(FRONT) - Date.parse(AS_OF)) / YEAR_MS;
    const { ev } = expectation((S) => (credit - Math.max(0, K - S)) * 100, 10000, 0.25, t);
    const exact = (credit - bsmPrice({ S: 10000, K, r: 0, T: t, sigma: 0.25, type: "put" })) * 100;
    expect(Math.abs(ev - exact)).toBeLessThan(2);
  });

  it("gives the lognormal probability of finishing above a level", () => {
    const { pop } = expectation((S) => (S > 10000 ? 1 : -1), 10000, 0.3, 0.25);
    // P(S_T > S_0) with zero price drift = N(−σ√t/2).
    expect(pop).toBeCloseTo(0.4701, 3);
  });
});

describe("rankAndDiversify", () => {
  const ev = (family: Structure["family"], score: number, theta = 0, name: string = family): Evaluation =>
    ({
      structure: { family, name, legs: [] },
      passed: true,
      score,
      economics: { theta_cents_per_day: theta },
    }) as unknown as Evaluation;

  it("keeps the best per family, three at most, by expected return on risk", () => {
    const out = rankAndDiversify([
      ev("iron_condor", 0.1),
      ev("iron_condor", 0.3),
      ev("put_credit_spread", 0.2),
      ev("calendar", 0.05),
      ev("long_butterfly", 0.15),
      { ...ev("jade_lizard", 0.9), passed: false },
    ]);
    expect(out.map((e) => [e.structure.family, e.score])).toEqual([
      ["iron_condor", 0.3],
      ["put_credit_spread", 0.2],
      ["long_butterfly", 0.15],
    ]);
  });

  it("breaks ties toward theta-positive and treats named custom structures separately", () => {
    const out = rankAndDiversify([ev("custom", 0.1, -5, "A"), ev("custom", 0.1, 8, "B"), ev("custom", 0.05, 0, "a")]);
    expect(out.map((e) => e.structure.name)).toEqual(["B", "A"]);
  });
});
