import { Leg, Strategy } from "./types";

// Per leg: realized P&L in cents
export function legPnLCents(leg: Leg): number {
  if (leg.exit_price_cents === null) return 0;

  const sideMultiplier = leg.side === "long" ? 1 : -1;
  const pnl =
    (leg.exit_price_cents - leg.entry_price_cents) *
    leg.qty *
    100 *
    sideMultiplier;

  return pnl - leg.fees_cents;
}

// Per strategy: realized P&L (closed legs only)
export function strategyRealizedPnLCents(
  strategy: Strategy,
  legs: Leg[]
): number {
  return legs.reduce((sum, leg) => sum + legPnLCents(leg), 0);
}

/**
 * Estimate collateral required for a strategy, in cents.
 *
 * Rules (approximations for a personal journal — not brokerage-exact):
 *  - Long-only legs:           0  (premium already paid, no margin)
 *  - Short single call/put:    strike × qty × 100  (cash-secured / naked approx)
 *  - Vertical (2 legs, same expiry, same type, opposite sides):
 *                              |strike_diff| × qty × 100  (spread width)
 *  - Iron condor (4 legs, 2 calls + 2 puts):
 *                              max(put spread width, call spread width) × qty × 100
 *  - Everything else:          null  (user must enter manually)
 *
 * Returns null when the shape cannot be auto-determined.
 */
export function strategyCollateralCents(legs: Leg[]): number | null {
  if (legs.length === 0) return null;

  const shortLegs = legs.filter((l) => l.side === "short");
  const longLegs = legs.filter((l) => l.side === "long");

  // All long — no collateral needed
  if (shortLegs.length === 0) return 0;

  // Single short leg (naked / cash-secured)
  if (legs.length === 1 && shortLegs.length === 1) {
    const leg = shortLegs[0];
    return leg.strike_cents * leg.qty * 100;
  }

  // Two-leg vertical: same expiry, same option type, one long + one short
  if (legs.length === 2 && shortLegs.length === 1 && longLegs.length === 1) {
    const s = shortLegs[0];
    const l = longLegs[0];
    if (s.option_type === l.option_type && s.expiry === l.expiry) {
      const width = Math.abs(s.strike_cents - l.strike_cents);
      return width * s.qty * 100;
    }
  }

  // Iron condor: 4 legs, 2 calls + 2 puts, one long + one short per type
  if (legs.length === 4) {
    const calls = legs.filter((l) => l.option_type === "call");
    const puts = legs.filter((l) => l.option_type === "put");
    if (calls.length === 2 && puts.length === 2) {
      const shortCall = calls.find((l) => l.side === "short");
      const longCall = calls.find((l) => l.side === "long");
      const shortPut = puts.find((l) => l.side === "short");
      const longPut = puts.find((l) => l.side === "long");
      if (shortCall && longCall && shortPut && longPut) {
        const callWidth = Math.abs(shortCall.strike_cents - longCall.strike_cents);
        const putWidth = Math.abs(shortPut.strike_cents - longPut.strike_cents);
        const qty = shortCall.qty; // assume same qty across all legs
        return Math.max(callWidth, putWidth) * qty * 100;
      }
    }
  }

  return null;
}

// Per strategy: net premium paid/received (positive = debit, negative = credit)
export function strategyNetPremiumCents(legs: Leg[]): number {
  return legs.reduce((sum, leg) => {
    const sign = leg.side === "long" ? 1 : -1;
    return sum + leg.entry_price_cents * leg.qty * 100 * sign;
  }, 0);
}

// Check if all legs are closed
export function isStrategyClosed(legs: Leg[]): boolean {
  return legs.every((leg) => leg.exit_price_cents !== null);
}

// Holding period in days
export function holdingPeriodDays(openedAt: string, closedAt: string): number {
  const start = new Date(openedAt);
  const end = new Date(closedAt);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

// Aggregate metrics across closed strategies
export function totalRealizedPnLCents(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>
): number {
  return strategies.reduce((sum, { strategy, legs }) => {
    if (!isStrategyClosed(legs)) return sum;
    return sum + strategyRealizedPnLCents(strategy, legs);
  }, 0);
}

export function winRate(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>
): number {
  const closed = strategies.filter(
    ({ strategy, legs }) => isStrategyClosed(legs) && strategy.closed_at !== null
  );
  if (closed.length === 0) return 0;

  const winners = closed.filter(
    ({ strategy, legs }) => strategyRealizedPnLCents(strategy, legs) > 0
  );
  return winners.length / closed.length;
}

export function avgWinCents(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>
): number {
  const closed = strategies.filter(
    ({ strategy, legs }) => isStrategyClosed(legs) && strategy.closed_at !== null
  );
  const winners = closed.filter(
    ({ strategy, legs }) => strategyRealizedPnLCents(strategy, legs) > 0
  );

  if (winners.length === 0) return 0;
  const sum = winners.reduce(
    (acc, { strategy, legs }) => acc + strategyRealizedPnLCents(strategy, legs),
    0
  );
  return sum / winners.length;
}

export function avgLossCents(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>
): number {
  const closed = strategies.filter(
    ({ strategy, legs }) => isStrategyClosed(legs) && strategy.closed_at !== null
  );
  const losers = closed.filter(
    ({ strategy, legs }) => strategyRealizedPnLCents(strategy, legs) < 0
  );

  if (losers.length === 0) return 0;
  const sum = losers.reduce(
    (acc, { strategy, legs }) => acc + strategyRealizedPnLCents(strategy, legs),
    0
  );
  return sum / losers.length; // negative value
}

// Equity curve: sorted closed strategies with cumulative P&L
export function equityCurve(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>
): Array<{ date: string; cumulativePnLCents: number }> {
  const closed = strategies.filter(
    ({ strategy, legs }) => isStrategyClosed(legs) && strategy.closed_at !== null
  );
  const sorted = closed.sort(
    (a, b) =>
      new Date(a.strategy.closed_at!).getTime() -
      new Date(b.strategy.closed_at!).getTime()
  );

  let cumulative = 0;
  return sorted.map(({ strategy, legs }) => {
    const pnl = strategyRealizedPnLCents(strategy, legs);
    cumulative += pnl;
    return {
      date: strategy.closed_at!.split("T")[0],
      cumulativePnLCents: cumulative,
    };
  });
}

// Max drawdown: largest peak-to-trough drop
export function maxDrawdownCents(
  curve: Array<{ date: string; cumulativePnLCents: number }>
): number {
  if (curve.length === 0) return 0;

  let peak = curve[0].cumulativePnLCents;
  let maxDD = 0;

  for (const point of curve) {
    if (point.cumulativePnLCents > peak) {
      peak = point.cumulativePnLCents;
    }
    const dd = peak - point.cumulativePnLCents;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }

  return maxDD;
}

// Avg holding period: all closed or filtered by winners/losers
export function avgHoldingPeriodDays(
  strategies: Array<{ strategy: Strategy; legs: Leg[] }>,
  filter?: "winners" | "losers"
): number {
  let closed = strategies.filter(
    ({ strategy, legs }) => isStrategyClosed(legs) && strategy.closed_at !== null
  );

  if (filter === "winners") {
    closed = closed.filter(
      ({ strategy, legs }) => strategyRealizedPnLCents(strategy, legs) > 0
    );
  } else if (filter === "losers") {
    closed = closed.filter(
      ({ strategy, legs }) => strategyRealizedPnLCents(strategy, legs) < 0
    );
  }

  if (closed.length === 0) return 0;

  const sum = closed.reduce(
    (acc, { strategy }) =>
      acc +
      holdingPeriodDays(strategy.opened_at, strategy.closed_at || new Date().toISOString()),
    0
  );
  return Math.round(sum / closed.length);
}
