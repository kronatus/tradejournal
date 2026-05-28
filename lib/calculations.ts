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
