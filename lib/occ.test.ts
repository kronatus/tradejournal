import { describe, it, expect } from "vitest";
import {
  parseOccSymbol,
  toStandardOcc,
  toStorageOcc,
  buildStorageOcc,
} from "./occ";

// The conversion between the storage format (strike in cents) and the standard
// format (strike in dollars x 1000) is what OCC_SYMBOLOGY.md calls the #1 source
// of bugs. These cases pin both directions and the historical failures.

describe("parseOccSymbol", () => {
  it("parses a storage-format symbol", () => {
    expect(parseOccSymbol("O:SPY260529C00075500")).toEqual({
      underlying: "SPY",
      expiry: "2026-05-29",
      strike: 755,
      type: "C",
    });
  });

  it("parses a fractional strike", () => {
    expect(parseOccSymbol("O:SPY260529P00075550").strike).toBe(755.5);
  });

  it("handles a one-character underlying", () => {
    expect(parseOccSymbol("O:F270115C00001200").underlying).toBe("F");
  });

  it("rejects a symbol without the O: prefix", () => {
    expect(() => parseOccSymbol("SPY260529C00755000")).toThrow(/Invalid OCC/);
  });

  it("rejects a malformed symbol", () => {
    expect(() => parseOccSymbol("O:SPY26052X00075500")).toThrow(/Invalid OCC/);
  });
});

describe("toStandardOcc", () => {
  it("converts cents strike to dollars x 1000", () => {
    expect(toStandardOcc("O:SPY260529C00075500")).toBe("SPY260529C00755000");
  });

  it("converts a fractional strike without losing the half dollar", () => {
    expect(toStandardOcc("O:SPY260529P00075550")).toBe("SPY260529P00755500");
  });

  it("pads a low strike to eight digits", () => {
    expect(toStandardOcc("O:F270115C00001200")).toBe("F270115C00012000");
  });

  // Historical bug #1: a cents-encoded strike reaching the provider. Tradier
  // surfaced it via unmatched_symbols; Marketdata returns `no_data` with no
  // error, so throwing here is the only place it can be caught.
  it("throws rather than passing a malformed symbol through to the provider", () => {
    expect(() => toStandardOcc("SPY260529C00075500")).toThrow(/Invalid OCC/);
    expect(() => toStandardOcc("")).toThrow(/Invalid OCC/);
  });
});

describe("toStorageOcc", () => {
  it("converts dollars x 1000 back to cents", () => {
    expect(toStorageOcc("SPY260529C00755000")).toBe("O:SPY260529C00075500");
  });

  it("rejects a symbol that still carries the O: prefix", () => {
    expect(() => toStorageOcc("O:SPY260529C00755000")).toThrow(/Invalid standard OCC/);
  });
});

describe("round trip", () => {
  it.each([
    "O:SPY260529C00075500",
    "O:SPY260529P00075550",
    "O:AAPL250117C00015000",
    "O:F270115C00001200",
    "O:TSLA261218P00120000",
  ])("survives storage -> standard -> storage for %s", (stored) => {
    expect(toStorageOcc(toStandardOcc(stored))).toBe(stored);
  });
});

describe("buildStorageOcc", () => {
  it("builds the storage format from parts", () => {
    expect(buildStorageOcc("spy", "2026-05-29", 75500, "call")).toBe(
      "O:SPY260529C00075500"
    );
  });

  it("round-trips through the parser", () => {
    const built = buildStorageOcc("AAPL", "2025-01-17", 15000, "put");
    expect(parseOccSymbol(built)).toEqual({
      underlying: "AAPL",
      expiry: "2025-01-17",
      strike: 150,
      type: "P",
    });
  });
});
