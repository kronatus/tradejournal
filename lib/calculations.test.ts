import { describe, it, expect } from "vitest";
import {
  legPnLCents,
  strategyNetPremiumCents,
  winRate,
  avgWinCents,
  avgLossCents,
  equityCurve,
  maxDrawdownCents,
  strategyOpenValueCents,
  strategyUnrealizedPnLCents,
} from "./calculations";
import { Leg, Strategy } from "./types";
import { formatCents } from "./utils";

const mockLeg = (overrides?: Partial<Leg>): Leg => ({
  id: "leg-1",
  strategy_id: "strat-1",
  occ_symbol: "O:AAPL250117C00150000",
  option_type: "call",
  strike_cents: 15000,
  expiry: "2025-01-17",
  side: "long",
  qty: 1,
  entry_price_cents: 200,
  exit_price_cents: 300,
  entry_at: new Date().toISOString(),
  exit_at: new Date().toISOString(),
  fees_cents: 50,
  entry_delta: 0.6,
  entry_gamma: 0.05,
  entry_theta: -0.1,
  entry_vega: 0.2,
  entry_iv: 0.25,
  exit_delta: 0.7,
  exit_gamma: 0.04,
  exit_theta: -0.05,
  exit_vega: 0.15,
  exit_iv: 0.23,
  external_open_fill_id: null,
  external_close_fill_id: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

const mockStrategy = (overrides?: Partial<Strategy>): Strategy => ({
  id: "strat-1",
  user_id: "user-1",
  underlying: "AAPL",
  strategy_kind: "long_call",
  conviction: 4,
  thesis: "Test thesis",
  post_mortem: null,
  planned_stop_cents: 14000,
  planned_target_cents: 16000,
  collateral_cents: null,
  current_value_cents: null,
  min_value_cents: null,
  max_value_cents: null,
  entry_net_delta: null,
  entry_net_gamma: null,
  entry_net_theta: null,
  entry_net_vega: null,
  current_net_delta: null,
  current_net_gamma: null,
  current_net_theta: null,
  current_net_vega: null,
  current_net_at: null,
  close_net_delta: null,
  close_net_gamma: null,
  close_net_theta: null,
  close_net_vega: null,
  close_net_at: null,
  mistake_tags: [],
  opened_at: "2025-01-10T10:00:00Z",
  closed_at: "2025-01-17T15:00:00Z",
  source: "manual",
  import_batch_id: null,
  external_group_ref: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("calculations", () => {
  describe("legPnLCents", () => {
    it("calculates P&L for long call", () => {
      const leg = mockLeg();
      // (300 - 200) * 1 * 100 * 1 - 50 = 9950
      expect(legPnLCents(leg)).toBe(9950);
    });

    it("calculates P&L for short call", () => {
      const leg = mockLeg({ side: "short" });
      // (300 - 200) * 1 * 100 * -1 - 50 = -10050
      expect(legPnLCents(leg)).toBe(-10050);
    });

    it("returns 0 if exit price is null", () => {
      const leg = mockLeg({ exit_price_cents: null });
      expect(legPnLCents(leg)).toBe(0);
    });
  });

  describe("strategyNetPremiumCents", () => {
    it("calculates debit for long call alone", () => {
      const legs = [mockLeg({ entry_price_cents: 100, qty: 1 })];
      // 100 * 1 * 100 * 1 = 10000 (paid $100)
      expect(strategyNetPremiumCents(legs)).toBe(10000);
    });

    it("calculates credit for short call alone", () => {
      const legs = [mockLeg({ side: "short", entry_price_cents: 100, qty: 1 })];
      // 100 * 1 * 100 * -1 = -10000 (received $100)
      expect(strategyNetPremiumCents(legs)).toBe(-10000);
    });

    it("calculates net debit for call vertical spread", () => {
      const legs = [
        mockLeg({ side: "long", entry_price_cents: 150, qty: 1, id: "leg-1" }),
        mockLeg({ side: "short", entry_price_cents: 100, qty: 1, id: "leg-2", strategy_id: "strat-1" }),
      ];
      // (150 * 1 * 100 * 1) + (100 * 1 * 100 * -1) = 15000 - 10000 = 5000 (net debit $50)
      expect(strategyNetPremiumCents(legs)).toBe(5000);
    });

    it("calculates net credit for credit spread", () => {
      const legs = [
        mockLeg({ side: "short", entry_price_cents: 150, qty: 1, id: "leg-1" }),
        mockLeg({ side: "long", entry_price_cents: 100, qty: 1, id: "leg-2", strategy_id: "strat-1" }),
      ];
      // (150 * 1 * 100 * -1) + (100 * 1 * 100 * 1) = -15000 + 10000 = -5000 (net credit $50)
      expect(strategyNetPremiumCents(legs)).toBe(-5000);
    });
  });

  describe("winRate", () => {
    it("calculates win rate", () => {
      const strategies = [
        { strategy: mockStrategy(), legs: [mockLeg()] },
        { strategy: mockStrategy({ id: "strat-2" }), legs: [mockLeg({ strategy_id: "strat-2", exit_price_cents: 100 })] }, // loser
      ];
      expect(winRate(strategies)).toBe(0.5);
    });

    it("returns 0 if no closed strategies", () => {
      const strategies = [
        {
          strategy: mockStrategy({ closed_at: null }),
          legs: [mockLeg({ exit_price_cents: null })],
        },
      ];
      expect(winRate(strategies)).toBe(0);
    });
  });

  describe("avgWinCents", () => {
    it("calculates average win", () => {
      const strategies = [
        { strategy: mockStrategy(), legs: [mockLeg()] }, // winner: 9950
      ];
      expect(avgWinCents(strategies)).toBe(9950);
    });

    it("returns 0 if no winners", () => {
      const strategies = [
        {
          strategy: mockStrategy(),
          legs: [mockLeg({ exit_price_cents: 100 })], // loser
        },
      ];
      expect(avgWinCents(strategies)).toBe(0);
    });
  });

  describe("avgLossCents", () => {
    it("calculates average loss", () => {
      const strategies = [
        {
          strategy: mockStrategy(),
          legs: [mockLeg({ exit_price_cents: 100 })],
        },
      ];
      const result = avgLossCents(strategies);
      expect(result).toBeLessThan(0);
    });

    it("returns 0 if no losers", () => {
      const strategies = [
        { strategy: mockStrategy(), legs: [mockLeg()] }, // winner
      ];
      expect(avgLossCents(strategies)).toBe(0);
    });
  });

  describe("equityCurve", () => {
    it("generates equity curve", () => {
      const strategies = [
        { strategy: mockStrategy({ closed_at: "2025-01-17T15:00:00Z" }), legs: [mockLeg()] },
      ];
      const curve = equityCurve(strategies);
      expect(curve).toHaveLength(1);
      expect(curve[0].cumulativePnLCents).toBe(9950);
    });
  });

  describe("maxDrawdownCents", () => {
    it("calculates max drawdown", () => {
      const curve = [
        { date: "2025-01-10", cumulativePnLCents: 0 },
        { date: "2025-01-11", cumulativePnLCents: 5000 },
        { date: "2025-01-12", cumulativePnLCents: 2000 },
        { date: "2025-01-13", cumulativePnLCents: 4000 },
      ];
      expect(maxDrawdownCents(curve)).toBe(3000);
    });

    it("returns 0 for empty curve", () => {
      expect(maxDrawdownCents([])).toBe(0);
    });
  });
});

describe("strategyOpenValueCents", () => {
  it("is negative for a credit spread — money was received", () => {
    const legs = [
      mockLeg({ side: "short", entry_price_cents: 1241, qty: 20, exit_price_cents: null }),
      mockLeg({ side: "long", entry_price_cents: 923, qty: 20, exit_price_cents: null }),
    ];
    // (-1241 + 923) * 20 * 100
    expect(strategyOpenValueCents(legs)).toBe(-636000);
  });

  it("is positive for a debit spread — money was paid", () => {
    const legs = [
      mockLeg({ side: "long", entry_price_cents: 1241, qty: 20, exit_price_cents: null }),
      mockLeg({ side: "short", entry_price_cents: 923, qty: 20, exit_price_cents: null }),
    ];
    expect(strategyOpenValueCents(legs)).toBe(636000);
  });

  it("ignores legs that are already closed", () => {
    const legs = [
      mockLeg({ side: "long", entry_price_cents: 500, qty: 1, exit_price_cents: null }),
      mockLeg({ side: "long", entry_price_cents: 900, qty: 1, exit_price_cents: 1200 }),
    ];
    expect(strategyOpenValueCents(legs)).toBe(50000);
  });

  it("is zero when every leg is closed", () => {
    const legs = [mockLeg({ entry_price_cents: 500, exit_price_cents: 700 })];
    expect(strategyOpenValueCents(legs)).toBe(0);
  });
});

describe("strategyUnrealizedPnLCents", () => {
  const openCreditSpread = [
    mockLeg({ side: "short", entry_price_cents: 1241, qty: 20, exit_price_cents: null }),
    mockLeg({ side: "long", entry_price_cents: 923, qty: 20, exit_price_cents: null }),
  ];

  it("shows a gain when a credit spread gets cheaper to close", () => {
    // Opened for -636000; now costs -500000 to close.
    const strategy = mockStrategy({ current_value_cents: -500000 });
    expect(strategyUnrealizedPnLCents(strategy, openCreditSpread)).toBe(136000);
  });

  it("shows a loss when it gets more expensive to close", () => {
    const strategy = mockStrategy({ current_value_cents: -800000 });
    expect(strategyUnrealizedPnLCents(strategy, openCreditSpread)).toBe(-164000);
  });

  it("is null when no quote has been fetched — unknown, not zero", () => {
    const strategy = mockStrategy({ current_value_cents: null });
    expect(strategyUnrealizedPnLCents(strategy, openCreditSpread)).toBeNull();
  });

  it("is null once every leg is closed", () => {
    const closed = [
      mockLeg({ side: "short", entry_price_cents: 1241, exit_price_cents: 0 }),
    ];
    const strategy = mockStrategy({ current_value_cents: -500000 });
    expect(strategyUnrealizedPnLCents(strategy, closed)).toBeNull();
  });

  it("marks only the open legs of a partially closed strategy", () => {
    const legs = [
      mockLeg({ side: "short", entry_price_cents: 1241, qty: 20, exit_price_cents: null }),
      mockLeg({ side: "long", entry_price_cents: 923, qty: 20, exit_price_cents: 1000 }),
    ];
    // Open leg cost -1241*20*100 = -2482000; marked at -2000000.
    const strategy = mockStrategy({ current_value_cents: -2000000 });
    expect(strategyUnrealizedPnLCents(strategy, legs)).toBe(482000);
  });
});

describe("missing database columns render as unknown, never NaN", () => {
  const openLegs = [
    mockLeg({ side: "short", entry_price_cents: 1241, qty: 20, exit_price_cents: null }),
  ];

  it("treats an absent current_value_cents as unknown", () => {
    // A column the remote database lacks arrives as undefined, not null.
    const strategy = { ...mockStrategy(), current_value_cents: undefined } as unknown as Strategy;
    expect(strategyUnrealizedPnLCents(strategy, openLegs)).toBeNull();
  });

  it("does not propagate NaN into unrealized P&L", () => {
    const strategy = { ...mockStrategy(), current_value_cents: NaN } as unknown as Strategy;
    expect(strategyUnrealizedPnLCents(strategy, openLegs)).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-4900)).toBe("-$49.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("renders unknown values as an em dash rather than $NaN", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(NaN)).toBe("—");
    expect(formatCents(Infinity)).toBe("—");
  });
});
