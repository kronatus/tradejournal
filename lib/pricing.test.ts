import { describe, it, expect } from "vitest";
import { bsmPrice, bsmGreeks } from "./pricing";

describe("Black-Scholes Option Pricing", () => {
  const testParams = {
    S: 100,
    K: 100,
    r: 0.05,
    T: 1,
    sigma: 0.2,
  };

  it("should price ATM call option (textbook)", () => {
    const price = bsmPrice({
      ...testParams,
      type: "call",
    });
    expect(price).toBeCloseTo(10.45, 1);
  });

  it("should price ATM put option (textbook)", () => {
    const price = bsmPrice({
      ...testParams,
      type: "put",
    });
    expect(price).toBeCloseTo(5.573, 1);
  });

  it("should satisfy put-call parity", () => {
    const call = bsmPrice({
      ...testParams,
      type: "call",
    });
    const put = bsmPrice({
      ...testParams,
      type: "put",
    });
    const discountFactor = Math.exp(-testParams.r * testParams.T);
    const parity = call - put;
    const expected =
      testParams.S - testParams.K * discountFactor;
    expect(parity).toBeCloseTo(expected, 2);
  });

  it("should return intrinsic value at expiry for call", () => {
    const price = bsmPrice({
      ...testParams,
      T: 0,
      type: "call",
    });
    expect(price).toBe(Math.max(0, testParams.S - testParams.K));
  });

  it("should return intrinsic value at expiry for put", () => {
    const price = bsmPrice({
      ...testParams,
      T: 0,
      type: "put",
    });
    expect(price).toBe(Math.max(0, testParams.K - testParams.S));
  });

  it("deep ITM call should approach spot price", () => {
    const price = bsmPrice({
      S: 200,
      K: 100,
      r: testParams.r,
      T: testParams.T,
      sigma: testParams.sigma,
      type: "call",
    });
    expect(price).toBeGreaterThan(95);
  });

  it("deep OTM call should approach 0", () => {
    const price = bsmPrice({
      S: 100,
      K: 200,
      r: testParams.r,
      T: testParams.T,
      sigma: testParams.sigma,
      type: "call",
    });
    expect(price).toBeLessThan(1);
  });

  it("should return 0 for zero volatility OTM call", () => {
    const price = bsmPrice({
      ...testParams,
      sigma: 0,
      K: 110,
      type: "call",
    });
    expect(price).toBe(0);
  });

  it("delta of ATM call should be close to 0.5", () => {
    const greeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    expect(greeks.delta).toBeCloseTo(0.5, 0.05);
  });

  it("delta of ITM call should be between 0 and 1", () => {
    const greeks = bsmGreeks({
      ...testParams,
      S: 110,
      type: "call",
    });
    expect(greeks.delta).toBeGreaterThan(0);
    expect(greeks.delta).toBeLessThan(1);
  });

  it("delta of OTM call should be between 0 and 1", () => {
    const greeks = bsmGreeks({
      ...testParams,
      S: 90,
      type: "call",
    });
    expect(greeks.delta).toBeGreaterThan(0);
    expect(greeks.delta).toBeLessThan(1);
  });

  it("put delta should be between -1 and 0", () => {
    const greeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(greeks.delta).toBeGreaterThan(-1);
    expect(greeks.delta).toBeLessThan(0);
  });

  it("gamma should always be positive", () => {
    const callGreeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    const putGreeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(callGreeks.gamma).toBeGreaterThan(0);
    expect(putGreeks.gamma).toBeGreaterThan(0);
  });

  it("gamma should be same for call and put at same params", () => {
    const callGreeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    const putGreeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(callGreeks.gamma).toBeCloseTo(putGreeks.gamma, 10);
  });

  it("vega should be positive for both calls and puts", () => {
    const callGreeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    const putGreeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(callGreeks.vega).toBeGreaterThan(0);
    expect(putGreeks.vega).toBeGreaterThan(0);
  });

  it("vega should be same for call and put at same params", () => {
    const callGreeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    const putGreeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(callGreeks.vega).toBeCloseTo(putGreeks.vega, 10);
  });

  it("theta should be negative for long call with sufficient time", () => {
    const greeks = bsmGreeks({
      ...testParams,
      type: "call",
    });
    expect(greeks.theta).toBeLessThan(0);
  });

  it("theta should be negative for long put with sufficient time", () => {
    const greeks = bsmGreeks({
      ...testParams,
      type: "put",
    });
    expect(greeks.theta).toBeLessThan(0);
  });

  it("at expiry, Greeks should return intrinsic delta and zero other Greeks", () => {
    const callGreeks = bsmGreeks({
      ...testParams,
      T: 0,
      type: "call",
    });
    expect(callGreeks.delta).toBe(0);
    expect(callGreeks.gamma).toBe(0);
    expect(callGreeks.theta).toBe(0);
    expect(callGreeks.vega).toBe(0);
  });

  it("for deep ITM call at expiry, delta should be 1", () => {
    const greeks = bsmGreeks({
      S: 200,
      K: 100,
      r: 0.05,
      T: 0,
      sigma: 0.2,
      type: "call",
    });
    expect(greeks.delta).toBe(1);
  });

  it("for deep OTM call at expiry, delta should be 0", () => {
    const greeks = bsmGreeks({
      S: 100,
      K: 200,
      r: 0.05,
      T: 0,
      sigma: 0.2,
      type: "call",
    });
    expect(greeks.delta).toBe(0);
  });

  it("for deep ITM put at expiry, delta should be -1", () => {
    const greeks = bsmGreeks({
      S: 100,
      K: 200,
      r: 0.05,
      T: 0,
      sigma: 0.2,
      type: "put",
    });
    expect(greeks.delta).toBe(-1);
  });

  it("short-dated option should have higher gamma than long-dated", () => {
    const shortGamma = bsmGreeks({
      ...testParams,
      T: 0.1,
      type: "call",
    }).gamma;
    const longGamma = bsmGreeks({
      ...testParams,
      T: 1,
      type: "call",
    }).gamma;
    expect(shortGamma).toBeGreaterThan(longGamma);
  });

  it("higher volatility should increase option price", () => {
    const lowVolPrice = bsmPrice({
      ...testParams,
      sigma: 0.1,
      type: "call",
    });
    const highVolPrice = bsmPrice({
      ...testParams,
      sigma: 0.3,
      type: "call",
    });
    expect(highVolPrice).toBeGreaterThan(lowVolPrice);
  });

  it("longer time to expiry should increase call value", () => {
    const shortTimePrice = bsmPrice({
      ...testParams,
      T: 0.1,
      type: "call",
    });
    const longTimePrice = bsmPrice({
      ...testParams,
      T: 1,
      type: "call",
    });
    expect(longTimePrice).toBeGreaterThan(shortTimePrice);
  });
});
