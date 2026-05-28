import { Leg } from "../types";

export type StrategyKind =
  | "long_call"
  | "long_put"
  | "short_call"
  | "short_put"
  | "vertical"
  | "iron_condor"
  | "calendar"
  | "straddle"
  | "strangle"
  | "custom";

export function inferStrategyKind(legs: Leg[]): StrategyKind {
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.option_type === "call") {
      return leg.side === "long" ? "long_call" : "short_call";
    } else {
      return leg.side === "long" ? "long_put" : "short_put";
    }
  }

  if (legs.length === 2) {
    const [l1, l2] = legs;
    const sameExpiry = l1.expiry === l2.expiry;
    const sameType = l1.option_type === l2.option_type;
    const oppositeType = l1.option_type !== l2.option_type;
    const oppositeSides = l1.side !== l2.side;
    const sameStrike = l1.strike_cents === l2.strike_cents;

    // Vertical: same expiry, same type, opposite sides
    if (sameExpiry && sameType && oppositeSides) {
      return "vertical";
    }

    // Straddle: same expiry, same strike, opposite types, both long or both short
    if (sameExpiry && sameStrike && oppositeType && l1.side === l2.side) {
      return "straddle";
    }

    // Strangle: same expiry, opposite types, both same side, different strikes
    if (sameExpiry && oppositeType && l1.side === l2.side) {
      return "strangle";
    }

    // Calendar: different expiries
    if (!sameExpiry) {
      return "calendar";
    }
  }

  if (legs.length === 4) {
    const calls = legs.filter((l) => l.option_type === "call");
    const puts = legs.filter((l) => l.option_type === "put");

    // Iron condor: 2 calls, 2 puts, same expiry
    if (calls.length === 2 && puts.length === 2) {
      const allSameExpiry = legs.every((l) => l.expiry === legs[0].expiry);
      if (allSameExpiry) {
        return "iron_condor";
      }
    }
  }

  return "custom";
}
