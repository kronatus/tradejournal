/**
 * Display and hand-off helpers for stored options strategy ideas: staleness,
 * leg descriptions, and the prefill links to the trade form ("Log as trade")
 * and the sandbox ("Open in Sandbox"). Pure; no I/O.
 */
import { STRATEGY_RULES } from "./strategy-rules";
import type { StrategyKind, StrategyIdea, StrategyIdeaLeg, StrategySet } from "./types";

export type Staleness = { stale: boolean; reasons: string[] };

/**
 * A set is stale once its quotes are older than the shortest horizon allows,
 * or the underlying has drifted more than `driftAtr` ATRs from the reference
 * price it was priced off. Stale sets get re-run, not traded.
 */
export function setStaleness(set: StrategySet, nowMs: number, spotCents: number | null): Staleness {
  const reasons: string[] = [];
  const horizons = set.ideas.length ? set.ideas.map((i) => i.horizon) : (set.horizons as ("short" | "long")[]);
  const limitMin = horizons.includes("short")
    ? STRATEGY_RULES.staleness.shortMinutes
    : STRATEGY_RULES.staleness.longMinutes;
  const ageMin = (nowMs - Date.parse(set.reference_at)) / 60_000;
  if (ageMin > limitMin) {
    reasons.push(`priced ${formatAge(ageMin)} ago (limit ${formatAge(limitMin)})`);
  }
  const atr = typeof set.regime?.atr_cents === "number" ? (set.regime.atr_cents as number) : null;
  if (spotCents !== null && atr) {
    const drift = Math.abs(spotCents - set.reference_price_cents);
    if (drift > STRATEGY_RULES.staleness.driftAtr * atr) {
      reasons.push(`price moved ${(drift / atr).toFixed(1)} ATR from the reference`);
    }
  }
  return { stale: reasons.length > 0, reasons };
}

function formatAge(min: number): string {
  if (min < 90) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dollars = (cents: number) => (cents / 100).toFixed(2);

/** "Sell 2 Nov 20 $97.50 put @ $1.52" */
export function describeLeg(l: StrategyIdeaLeg, units = 1): string {
  const [, m, d] = l.expiry.split("-");
  const qty = l.ratio * units;
  return `${l.side === "long" ? "Buy" : "Sell"} ${qty} ${MONTHS[Number(m) - 1]} ${Number(d)} $${dollars(l.strike_cents)} ${l.type} @ $${dollars(l.fill_cents)}`;
}

/** The journal's descriptive strategy_kind for a family (custom when it has no equivalent). */
export function strategyKindFor(idea: Pick<StrategyIdea, "family">): StrategyKind {
  switch (idea.family) {
    case "put_credit_spread":
    case "call_credit_spread":
    case "put_debit_spread":
    case "call_debit_spread":
      return "vertical";
    case "iron_condor":
      return "iron_condor";
    case "calendar":
      return "calendar";
    case "cash_secured_put":
      return "short_put";
    default:
      return "custom";
  }
}

export type TradePrefill = {
  underlying: string;
  strategy_kind: StrategyKind;
  notes: string;
  legs: {
    side: "buy" | "sell";
    optionType: "C" | "P";
    strike: string;
    expiry: string;
    quantity: number;
    entry_price_cents: number;
  }[];
};

/** Prefill for the new-trade form, at the idea's sized quantity and natural prices. */
export function ideaToTradePrefill(idea: StrategyIdea, symbol: string): TradePrefill {
  const units = idea.sizing?.qty ?? 1;
  return {
    underlying: symbol,
    strategy_kind: strategyKindFor(idea),
    notes: [`${idea.label} (${idea.horizon === "short" ? "0–3" : "4–21"} DTE idea)`, idea.rationale, idea.exit_plan && `Exit: ${idea.exit_plan}`]
      .filter(Boolean)
      .join("\n"),
    legs: idea.legs.map((l) => ({
      side: l.side === "long" ? "buy" : "sell",
      optionType: l.type === "call" ? "C" : "P",
      strike: dollars(l.strike_cents),
      expiry: l.expiry,
      quantity: l.ratio * units,
      entry_price_cents: l.fill_cents,
    })),
  };
}

export const tradeHref = (setId: string, rank: number) =>
  `/trades/new?set=${encodeURIComponent(setId)}&idea=${rank}`;

export type SandboxSeedLeg = {
  optionType: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiry: string;
  qty: number;
  entryPrice: number;
  iv: number;
};

/** `/sandbox?symbol=…&spot=…&legs=c:s:1:97.50:2026-11-20:1.52:0.3,…` */
export function sandboxHref(idea: StrategyIdea, symbol: string, spotCents: number): string {
  const units = idea.sizing?.qty ?? 1;
  const legs = idea.legs
    .map((l) =>
      [
        l.type === "call" ? "c" : "p",
        l.side === "long" ? "l" : "s",
        l.ratio * units,
        dollars(l.strike_cents),
        l.expiry,
        dollars(l.fill_cents),
        l.iv ?? idea.economics.sigma_implied ?? 0.3,
      ].join(":")
    )
    .join(",");
  return `/sandbox?symbol=${encodeURIComponent(symbol)}&spot=${dollars(spotCents)}&legs=${encodeURIComponent(legs)}`;
}

/** Parse the sandbox seed; malformed legs are dropped, never guessed. */
export function parseSandboxLegs(param: string | null): SandboxSeedLeg[] {
  if (!param) return [];
  const out: SandboxSeedLeg[] = [];
  for (const raw of param.split(",")) {
    const [t, s, qty, strike, expiry, price, iv] = raw.split(":");
    const leg = {
      optionType: t === "c" ? "call" : t === "p" ? "put" : null,
      side: s === "l" ? "long" : s === "s" ? "short" : null,
      qty: Number(qty),
      strike: Number(strike),
      expiry,
      entryPrice: Number(price),
      iv: Number(iv),
    };
    if (
      leg.optionType &&
      leg.side &&
      Number.isInteger(leg.qty) &&
      leg.qty > 0 &&
      leg.strike > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(expiry ?? "") &&
      leg.entryPrice >= 0 &&
      leg.iv > 0
    ) {
      out.push(leg as SandboxSeedLeg);
    }
  }
  return out;
}
