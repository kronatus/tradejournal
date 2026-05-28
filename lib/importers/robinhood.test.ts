import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { parse } from "./robinhood";

const csv = readFileSync("tests/samples/rhExtract.csv", "utf-8");

describe("Robinhood CSV Parser", () => {
  it("should parse 36 valid fills", () => {
    const result = parse(csv);
    expect(result.fills.length).toBe(36);
  });

  it("should skip 5 rows", () => {
    const result = parse(csv);
    expect(result.skipped.length).toBe(5);
  });

  it("BTO should parse correctly (ORCL 5/15/2026 Call $155)", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "ORCL" &&
        f.option_type === "call" &&
        f.strike_cents === 15500
    );

    expect(fill).toBeDefined();
    expect(fill?.expiry).toBe("2026-05-15");
    expect(fill?.action).toBe("open");
    expect(fill?.side).toBe("long");
    expect(fill?.qty).toBe(1);
  });

  it("STO should parse correctly (SPY 4/14 Call $684)", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.expiry === "2026-04-17" &&
        f.option_type === "call" &&
        f.strike_cents === 68400 &&
        f.action === "open" &&
        f.side === "short"
    );

    expect(fill).toBeDefined();
    expect(fill?.qty).toBe(5);
  });

  it("BTC should parse correctly (SPY 4/14 Call $680)", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.expiry === "2026-04-17" &&
        f.option_type === "call" &&
        f.strike_cents === 68000 &&
        f.action === "close" &&
        f.side === "long"
    );

    expect(fill).toBeDefined();
  });

  it("STC should parse correctly (SPY 4/14 Put $670 qty 1)", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.expiry === "2026-04-17" &&
        f.option_type === "put" &&
        f.strike_cents === 67000 &&
        f.action === "close" &&
        f.side === "short" &&
        f.qty === 1
    );

    expect(fill).toBeDefined();
  });

  it("OEXP short (10S) should parse correctly", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.expiry === "2026-03-13" &&
        f.option_type === "call" &&
        f.strike_cents === 67000 &&
        f.action === "close" &&
        f.side === "short"
    );

    expect(fill).toBeDefined();
    expect(fill?.qty).toBe(10);
    expect(fill?.price_cents).toBe(0);
    expect(fill?.fees_cents).toBe(0);
  });

  it("OEXP long should have side='long' when no S suffix", () => {
    const syntheticCsv = `Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount
4/1/2026,4/1/2026,4/2/2026,SPY,Option Expiration for SPY 4/17/2026 Call $670.00,OEXP,5,,$0.00`;

    const result = parse(syntheticCsv);
    expect(result.fills.length).toBe(1);
    expect(result.fills[0]?.side).toBe("long");
  });

  it("should calculate fees correctly for STO 5 @ $11.02", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.action === "open" &&
        f.side === "short" &&
        f.price_cents === 1102 &&
        f.qty === 5
    );

    expect(fill).toBeDefined();
    expect(fill?.fees_cents).toBe(34);
  });

  it("should calculate fees correctly for BTC 5 @ $12.24", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.action === "close" &&
        f.side === "long" &&
        f.price_cents === 1224 &&
        f.qty === 5 &&
        f.strike_cents === 68000
    );

    expect(fill).toBeDefined();
    expect(fill?.fees_cents).toBe(20);
  });

  it("should calculate fees correctly for STC 1 @ $0.48", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "SPY" &&
        f.action === "close" &&
        f.side === "short" &&
        f.price_cents === 48 &&
        f.qty === 1
    );

    expect(fill).toBeDefined();
    expect(fill?.fees_cents).toBe(6);
  });

  it("should skip ACH deposit", () => {
    const result = parse(csv);
    const achSkipped = result.skipped.find((s) => s.reason.includes("ACH"));
    expect(achSkipped).toBeDefined();
  });

  it("should skip OEXCS", () => {
    const result = parse(csv);
    const oexcsSkipped = result.skipped.find((s) =>
      s.reason.includes("OEXCS")
    );
    expect(oexcsSkipped).toBeDefined();
  });

  it("should skip OASGN", () => {
    const result = parse(csv);
    const oasgnSkipped = result.skipped.find((s) =>
      s.reason.includes("OASGN")
    );
    expect(oasgnSkipped).toBeDefined();
  });

  it("should skip stock-delivery rows", () => {
    const result = parse(csv);
    const stockSkipped = result.skipped.filter(
      (s) =>
        s.reason === "Multi-line description (stock delivery)" ||
        s.reason === "Stock delivery row (CUSIP)"
    );
    expect(stockSkipped.length).toBeGreaterThanOrEqual(2);
  });

  it("should parse dates correctly (4/14/2026)", () => {
    const result = parse(csv);
    const fill = result.fills.find((f) => f.underlying === "SPY");

    expect(fill).toBeDefined();
    if (fill) {
      expect(fill.filled_at.getFullYear()).toBe(2026);
      expect(fill.filled_at.getMonth()).toBe(3); // 0-indexed
      expect(fill.filled_at.getDate()).toBe(14);
    }
  });

  it("should parse expiry format correctly (4/17/2026 -> 2026-04-17)", () => {
    const result = parse(csv);
    const fill = result.fills.find((f) => f.underlying === "SPY");

    expect(fill).toBeDefined();
    expect(fill?.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should parse strike with decimal correctly (RKT Put $18.00)", () => {
    const result = parse(csv);
    const fill = result.fills.find(
      (f) =>
        f.underlying === "RKT" &&
        f.option_type === "put" &&
        f.strike_cents === 1800
    );

    expect(fill).toBeDefined();
  });

  it("should have unique external_fill_id for all 36 fills", () => {
    const result = parse(csv);
    const ids = result.fills.map((f) => f.external_fill_id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(36);
  });
});
