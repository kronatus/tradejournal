/**
 * Strategy catalogue: turns eligible families + a chain slice + anchor levels
 * into concrete candidate structures for lib/strategy-economics.ts to price
 * and gate.
 *
 * Short strikes anchor to real levels: short puts at or below the nearest
 * support, short calls at or above the nearest resistance (within
 * `anchorToleranceAtr`), and, when earnings fall inside the window, outside
 * the expected move. Builders emit only shapes whose risk is defined; the
 * economics engine re-checks that from the payoff regardless.
 */
import { contractKey, type ChainContract, type OptionType, type Structure, type StructureLeg } from "./strategy-economics";
import { STRATEGY_RULES, type Bias, type StrategyFamily } from "./strategy-rules";

export type CatalogInput = {
  chain: ChainContract[];
  spot_cents: number;
  supports: number[];
  resistances: number[];
  atr_cents: number | null;
  /** Short strikes must sit at least this far from spot (expected move into earnings). */
  min_short_distance_cents: number;
  families: StrategyFamily[];
  bias: Bias;
  /** Front expiries eligible for this horizon. */
  front_expiries: string[];
};

type Book = {
  strikes: (expiry: string, type: OptionType) => number[];
  has: (expiry: string, type: OptionType, strike: number) => boolean;
  expiries: string[];
};

function book(chain: ChainContract[]): Book {
  const keys = new Set(chain.map(contractKey));
  const by = new Map<string, number[]>();
  for (const c of chain) {
    const k = `${c.expiry}|${c.type}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(c.strike_cents);
  }
  for (const v of by.values()) v.sort((a, b) => a - b);
  return {
    strikes: (expiry, type) => [...new Set(by.get(`${expiry}|${type}`) ?? [])],
    has: (expiry, type, strike) => keys.has(contractKey({ expiry, type, strike_cents: strike })),
    expiries: [...new Set(chain.map((c) => c.expiry))].sort(),
  };
}

const L = (side: StructureLeg["side"], type: OptionType, strike: number, expiry: string, ratio = 1): StructureLeg => ({
  side,
  type,
  strike_cents: strike,
  expiry,
  ratio,
});

/** Strikes strictly below `k`, nearest first. */
const below = (strikes: number[], k: number, n: number) => strikes.filter((s) => s < k).reverse().slice(0, n);
/** Strikes strictly above `k`, nearest first. */
const above = (strikes: number[], k: number, n: number) => strikes.filter((s) => s > k).slice(0, n);
/** The `n` strikes nearest `k`. */
const nearest = (strikes: number[], k: number, n: number) =>
  [...strikes].sort((a, b) => Math.abs(a - k) - Math.abs(b - k) || a - b).slice(0, n);

export function buildStructures(input: CatalogInput): Structure[] {
  const b = book(input.chain);
  const spot = input.spot_cents;
  const atr = input.atr_cents ?? spot * 0.015;
  const tol = STRATEGY_RULES.anchorToleranceAtr * atr;
  const putAnchor = input.supports[0] ?? spot - 0.5 * atr;
  const callAnchor = input.resistances[0] ?? spot + 0.5 * atr;
  const minDist = input.min_short_distance_cents;
  const fam = new Set(input.families);
  const out: Structure[] = [];
  const push = (family: StrategyFamily, legs: StructureLeg[]) => out.push({ family, name: family, legs });

  for (const front of input.front_expiries) {
    const puts = b.strikes(front, "put");
    const calls = b.strikes(front, "call");
    const shortPuts = puts
      .filter((k) => k < spot && k <= putAnchor + tol && k <= spot - minDist)
      .reverse()
      .slice(0, 4);
    const shortCalls = calls.filter((k) => k > spot && k >= callAnchor - tol && k >= spot + minDist).slice(0, 4);

    if (fam.has("put_credit_spread")) {
      for (const s of shortPuts) for (const l of below(puts, s, 4)) push("put_credit_spread", [L("short", "put", s, front), L("long", "put", l, front)]);
    }
    if (fam.has("call_credit_spread")) {
      for (const s of shortCalls) for (const l of above(calls, s, 4)) push("call_credit_spread", [L("short", "call", s, front), L("long", "call", l, front)]);
    }
    if (fam.has("cash_secured_put")) {
      for (const s of shortPuts) push("cash_secured_put", [L("short", "put", s, front)]);
    }
    if (fam.has("iron_condor")) {
      // Balanced and unbalanced (skip-strike) wings alike.
      for (const sp of shortPuts.slice(0, 3))
        for (const lp of below(puts, sp, 3))
          for (const sc of shortCalls.slice(0, 3))
            for (const lc of above(calls, sc, 3))
              push("iron_condor", [L("long", "put", lp, front), L("short", "put", sp, front), L("short", "call", sc, front), L("long", "call", lc, front)]);
    }
    if (fam.has("iron_butterfly") && minDist === 0) {
      for (const center of nearest(puts.filter((k) => calls.includes(k)), spot, 2))
        for (const lp of below(puts, center, 5))
          for (const lc of above(calls, center, 5))
            push("iron_butterfly", [L("long", "put", lp, front), L("short", "put", center, front), L("short", "call", center, front), L("long", "call", lc, front)]);
    }
    if (fam.has("long_butterfly")) {
      for (const center of nearest(calls, spot, 3)) {
        const type: OptionType = center >= spot ? "call" : "put";
        const strikes = type === "call" ? calls : puts;
        for (const lo of below(strikes, center, 4)) {
          const hi = 2 * center - lo;
          if (b.has(front, type, hi) && b.has(front, type, center)) {
            push("long_butterfly", [L("long", type, lo, front), L("short", type, center, front, 2), L("long", type, hi, front)]);
          }
        }
      }
    }
    if (fam.has("put_broken_wing_butterfly")) {
      let bodies = puts.filter((k) => k <= spot && k >= putAnchor - tol).reverse().slice(0, 4);
      if (!bodies.length) bodies = below(puts, spot, 2);
      for (const body of bodies) bwb(out, "put_broken_wing_butterfly", "put", puts, body, front);
    }
    if (fam.has("call_broken_wing_butterfly")) {
      let bodies = calls.filter((k) => k >= spot && k <= callAnchor + tol).slice(0, 4);
      if (!bodies.length) bodies = above(calls, spot, 2);
      for (const body of bodies) bwb(out, "call_broken_wing_butterfly", "call", calls, body, front);
    }
    if (fam.has("jade_lizard")) {
      for (const sp of shortPuts.slice(0, 3))
        for (const sc of shortCalls.slice(0, 3))
          for (const lc of above(calls, sc, 3))
            push("jade_lizard", [L("short", "put", sp, front), L("short", "call", sc, front), L("long", "call", lc, front)]);
    }
    if (fam.has("put_ratio_spread")) {
      for (const lp of puts.filter((k) => k <= spot).reverse().slice(0, 2))
        for (const sp of shortPuts.filter((k) => k < lp))
          push("put_ratio_spread", [L("long", "put", lp, front), L("short", "put", sp, front, 2)]);
    }
    if (fam.has("call_debit_spread")) {
      for (const lc of nearest(calls, spot, 3)) {
        const targets = calls.filter((k) => k > lc && k <= callAnchor + atr).slice(0, 4);
        for (const sc of targets) push("call_debit_spread", [L("long", "call", lc, front), L("short", "call", sc, front)]);
      }
    }
    if (fam.has("put_debit_spread")) {
      for (const lp of nearest(puts, spot, 3)) {
        const targets = puts.filter((k) => k < lp && k >= putAnchor - atr).reverse().slice(0, 4);
        for (const sp of targets) push("put_debit_spread", [L("long", "put", lp, front), L("short", "put", sp, front)]);
      }
    }

    // Time spreads: back months within the allowed gap.
    const backs = b.expiries.filter(
      (e) => e > front && (Date.parse(e) - Date.parse(front)) / 86_400_000 <= STRATEGY_RULES.maxBackMonthGapDays
    );
    for (const back of backs) {
      if (fam.has("calendar")) {
        const centers = new Set([...nearest(calls, spot, 2), ...nearest(calls, callAnchor, 1), ...nearest(puts, putAnchor, 1)]);
        for (const k of centers) {
          const type: OptionType = k >= spot ? "call" : "put";
          if (b.has(front, type, k) && b.has(back, type, k)) {
            push("calendar", [L("short", type, k, front), L("long", type, k, back)]);
          }
        }
      }
      if (fam.has("diagonal")) {
        if (input.bias !== "bearish") {
          // Long an in-the-money back-month call, short the front month at resistance.
          for (const lk of below(b.strikes(back, "call"), spot, 3))
            for (const sk of shortCalls.slice(0, 2))
              push("diagonal", [L("long", "call", lk, back), L("short", "call", sk, front)]);
        }
        if (input.bias !== "bullish") {
          for (const lk of above(b.strikes(back, "put"), spot, 3))
            for (const sk of shortPuts.slice(0, 2))
              push("diagonal", [L("long", "put", lk, back), L("short", "put", sk, front)]);
        }
      }
      if (fam.has("double_diagonal")) {
        const bPuts = b.strikes(back, "put");
        const bCalls = b.strikes(back, "call");
        for (const sp of shortPuts.slice(0, 2))
          for (const lp of below(bPuts, sp, 2))
            for (const sc of shortCalls.slice(0, 2))
              for (const lc of above(bCalls, sc, 2))
                push("double_diagonal", [L("long", "put", lp, back), L("short", "put", sp, front), L("short", "call", sc, front), L("long", "call", lc, back)]);
      }
    }
  }
  return out.slice(0, STRATEGY_RULES.maxCandidatesEvaluated);
}

/**
 * Broken-wing butterfly around `body`: a narrow wing toward spot and a wider
 * wing away from it, so the position is entered near zero cost or a credit
 * and carries risk only beyond the wide wing.
 */
function bwb(out: Structure[], family: StrategyFamily, type: OptionType, strikes: number[], body: number, expiry: string) {
  const toward = type === "put" ? above(strikes, body, 3) : below(strikes, body, 3);
  const away = type === "put" ? below(strikes, body, 6) : above(strikes, body, 6);
  for (const near of toward) {
    const narrow = Math.abs(near - body);
    for (const far of away) {
      if (Math.abs(body - far) <= narrow) continue;
      out.push({
        family,
        name: family,
        legs: [
          { side: "long", type, strike_cents: near, expiry, ratio: 1 },
          { side: "short", type, strike_cents: body, expiry, ratio: 2 },
          { side: "long", type, strike_cents: far, expiry, ratio: 1 },
        ],
      });
    }
  }
}
