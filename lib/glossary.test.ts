import { describe, expect, it } from "vitest";
import { lookupTerm } from "./glossary";
import { SCAN_THRESHOLDS } from "./market-scan";
import { STRATEGY_RULES } from "./strategy-rules";

const term = (k: string) => lookupTerm(k)?.term ?? null;

describe("lookupTerm", () => {
  it("resolves display keys", () => {
    expect(term("pe")).toBe("P/E");
    expect(term("trend")).toBe("Trend");
    expect(term("REL_VOL")).toBe("Volume spike");
    expect(term("contribution")).toBe("Contribution (bps)");
  });

  it("normalises the metric names Claude writes, including periods", () => {
    expect(term("sma50_cents")).toBe("SMA 50");
    expect(term("SMA200")).toBe("SMA 200");
    expect(term("ema21_cents")).toBe("EMA 21");
    expect(term("rsi14")).toBe("RSI 14");
    expect(term("rsi")).toBe("RSI");
    expect(term("dist_sma200_pct")).toBe("Distance from SMA 200");
    expect(term("dist_window_high_pct")).toBe("Distance from high");
    expect(term("dist_target_pct")).toBe("Distance from target");
    expect(term("atr14_cents")).toBe("ATR");
    expect(term("atr14_pct")).toBe("ATR %");
    expect(term("hv20")).toBe("Historical volatility");
    expect(term("iv_rank")).toBe("IV rank");
    expect(term("rel_volume")).toBe("Relative volume");
    expect(term("avg_volume_20d")).toBe("Volume average");
    expect(term("macd_line_cents")).toBe("MACD");
    expect(term("macd_signal_cents")).toBe("MACD signal");
    expect(term("macd_hist_cents")).toBe("MACD histogram");
    expect(term("max_drawdown_pct")).toBe("Max drawdown");
    expect(term("ret_20d")).toBe("Return");
    expect(term("return_z")).toBe("z-score");
  });

  it("explains the period-specific intent of moving averages", () => {
    expect(lookupTerm("sma200")!.why).toMatch(/long-term/);
    expect(lookupTerm("sma50")!.why).toMatch(/medium-term/);
    expect(lookupTerm("sma20")!.why).toMatch(/short-term/);
    expect(lookupTerm("sma50")!.what).toMatch(/last 50 sessions/);
  });

  it("returns null for unknown or empty keys", () => {
    expect(lookupTerm("foo_bar")).toBeNull();
    expect(lookupTerm("")).toBeNull();
    expect(lookupTerm(undefined)).toBeNull();
  });

  it("covers every anomaly flag the scan can raise", () => {
    for (const flag of ["REL_VOL", "RET_Z", "GAP", "NEW_HIGH", "NEW_LOW", "SECTOR_DIVERGENCE", "QUIET_ACCUMULATION", "STREAK"]) {
      expect(lookupTerm(flag), flag).not.toBeNull();
    }
    // The explanations quote the scan's thresholds; keep them in step.
    expect(lookupTerm("REL_VOL")!.what).toContain(`${SCAN_THRESHOLDS.relVolume}×`);
    expect(lookupTerm("GAP")!.what).toContain(`${SCAN_THRESHOLDS.gapPct}%`);
  });

  it("explains the options strategy gate with its real thresholds", () => {
    expect(lookupTerm("risk_reward")!.why).toContain(`${STRATEGY_RULES.maxRiskToReward} : 1`);
    expect(lookupTerm("max_loss")!.why).toContain(`${STRATEGY_RULES.maxAccountRiskFraction * 100}%`);
    for (const k of ["pop", "ev", "ev_on_risk", "gap_test", "natural_price", "theta", "breakeven"]) {
      expect(lookupTerm(k), k).not.toBeNull();
    }
  });

  it("keeps every entry short", () => {
    const keys = ["pe", "pb", "beta", "iv", "macd", "atr", "breadth", "QUIET_ACCUMULATION", "sma50", "rsi14", "pop", "ev", "risk_reward", "max_loss", "gap_test", "natural_price", "theta", "breakeven", "ev_on_risk"];
    for (const k of keys) {
      const e = lookupTerm(k)!;
      expect(e.what.length + e.why.length, k).toBeLessThan(260);
    }
  });
});
