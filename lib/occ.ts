// OCC option symbol handling.
//
// Two formats coexist in this project — see OCC_SYMBOLOGY.md.
//
//   Storage  (DB `legs.occ_symbol`):  O:SPY260529C00075500   strike in CENTS
//   Standard (Tradier, Marketdata):     SPY260529C00755000    strike in dollars x 1000
//
// Both Tradier and Marketdata.app speak the standard form, so the conversion
// below is provider-neutral. This module is the ONLY place either format is
// parsed or built; see lib/occ.test.ts for the round-trip coverage.

const STORAGE_OCC_RE = /^O:([A-Z]{1,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const STANDARD_OCC_RE = /^([A-Z]{1,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export type ParsedOcc = {
  underlying: string;
  /** YYYY-MM-DD */
  expiry: string;
  /** Strike in dollars, e.g. 755.5 */
  strike: number;
  type: "C" | "P";
};

/** Parse the storage format (`O:` prefix, strike in cents). */
export function parseOccSymbol(occ: string): ParsedOcc {
  const match = occ.match(STORAGE_OCC_RE);
  if (!match) throw new Error(`Invalid OCC format: ${occ}`);

  const [, underlying, yy, mm, dd, optionType, strike] = match;
  return {
    underlying,
    expiry: `${parseInt(yy, 10) + 2000}-${mm}-${dd}`,
    strike: parseInt(strike, 10) / 100,
    type: optionType as "C" | "P",
  };
}

/**
 * Storage format -> standard OCC, as Tradier and Marketdata.app expect it.
 * Throws on malformed input rather than passing the string through: a
 * cents-encoded strike reaching a provider is the historical bug #1 in
 * OCC_SYMBOLOGY.md, and Marketdata answers an unknown symbol with `no_data`
 * rather than an error, so a silent pass-through would be invisible.
 */
export function toStandardOcc(occ: string): string {
  const { underlying, expiry, strike, type } = parseOccSymbol(occ);
  const [year, month, day] = expiry.split("-");
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${underlying}${year.slice(-2)}${month}${day}${type}${strikeStr}`;
}

/** Standard OCC -> storage format. Inverse of toStandardOcc. */
export function toStorageOcc(standard: string): string {
  const match = standard.match(STANDARD_OCC_RE);
  if (!match) throw new Error(`Invalid standard OCC format: ${standard}`);

  const [, underlying, yy, mm, dd, optionType, strike] = match;
  const strikeCents = String(Math.round(parseInt(strike, 10) / 10)).padStart(8, "0");
  return `O:${underlying}${yy}${mm}${dd}${optionType}${strikeCents}`;
}

/** Build a storage-format symbol from parts. `strikeCents` is an integer. */
export function buildStorageOcc(
  underlying: string,
  expiry: string,
  strikeCents: number,
  optionType: "call" | "put"
): string {
  const [year, month, day] = expiry.split("-");
  const strikeStr = String(Math.round(strikeCents)).padStart(8, "0");
  const typeChar = optionType === "call" ? "C" : "P";
  return `O:${underlying.toUpperCase()}${year.slice(-2)}${month}${day}${typeChar}${strikeStr}`;
}
