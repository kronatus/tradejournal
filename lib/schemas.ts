import { z } from "zod";

// OCC symbol: O:AAPL250117C00150000
export const OccSymbolSchema = z
  .string()
  .regex(/^O:[A-Z]{1,5}\d{6}[CP]\d{8}$/, "Invalid OCC format");

export const LegInputSchema = z.object({
  occ_symbol: OccSymbolSchema,
  side: z.enum(["buy", "sell"]),
  action: z.enum(["open", "close"]),
  quantity: z.number().int().positive(),
  entry_price_cents: z.number().int().nonnegative(),
  exit_price_cents: z.number().int().nullable().optional(),
  stop_loss_cents: z.number().int().nullable().optional(),
  target_cents: z.number().int().nullable().optional(),
});

export const StrategyInputSchema = z.object({
  underlying: z.string().min(1).max(5),
  strategy_kind: z.enum([
    "long_call",
    "long_put",
    "short_call",
    "short_put",
    "vertical",
    "iron_condor",
    "calendar",
    "straddle",
    "strangle",
    "custom",
  ]),
  conviction_rating: z.number().int().min(1).max(5),
  notes: z.string().default(""),
  opened_at: z.string().datetime(),
  legs: z.array(LegInputSchema).min(1),
});

export const QuoteSchema = z.object({
  // A deep-OTM contract can legitimately mark at zero. Treat that as data,
  // not as a missing quote -- dropping it silently understates the position.
  price: z.number().nonnegative(),
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
  iv: z.number().nonnegative(),
  asOf: z.string().datetime(),
  // True when the provider returned a price but no Greeks. Callers must not
  // fold these into net Greeks -- zero is a claim, absence is not.
  greeksMissing: z.boolean().default(false),
  // Spot price of the underlying, when the provider supplies it alongside the
  // option quote. Free here -- it rides along in the same response.
  underlyingPrice: z.number().positive().nullable().default(null),
});

export const CanonicalFillSchema = z.object({
  external_fill_id: z.string().min(1),
  external_group_ref: z.string().nullable(),
  filled_at: z.coerce.date(),
  underlying: z.string().min(1).max(5).toUpperCase(),
  option_type: z.enum(["call", "put"]),
  strike_cents: z.number().int().positive(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  side: z.enum(["long", "short"]),
  action: z.enum(["open", "close"]),
  qty: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  fees_cents: z.number().int().nonnegative(),
});

export const ColumnMappingSchema = z.record(
  z.enum([
    "filled_at",
    "underlying",
    "option_type",
    "strike_cents",
    "expiry",
    "side",
    "action",
    "qty",
    "price_cents",
    "fees_cents",
    "external_fill_id",
    "external_group_ref",
  ]),
  z.string()
);

export const StrategyPatchSchema = z.object({
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  thesis: z.string().nullable().optional(),
  post_mortem: z.string().nullable().optional(),
  planned_stop_cents: z.number().int().nonnegative().nullable().optional(),
  planned_target_cents: z.number().int().nonnegative().nullable().optional(),
  collateral_cents: z.number().int().nonnegative().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
});

export const LegClosePatchSchema = z.object({
  exit_price_cents: z.number().int().nonnegative(),
  exit_at: z.string().datetime(),
  exit_delta: z.number().nullable().optional(),
  exit_gamma: z.number().nullable().optional(),
  exit_theta: z.number().nullable().optional(),
  exit_vega: z.number().nullable().optional(),
  exit_iv: z.number().nullable().optional(),
});

export const LegCreateSchema = z.object({
  occ_symbol: OccSymbolSchema,
  option_type: z.enum(["call", "put"]),
  side: z.enum(["long", "short"]),
  qty: z.number().int().positive(),
  entry_price_cents: z.number().int().nonnegative(),
  entry_at: z.string().datetime(),
  fees_cents: z.number().int().nonnegative().default(0),
  entry_delta: z.number().nullable().optional(),
  entry_gamma: z.number().nullable().optional(),
  entry_theta: z.number().nullable().optional(),
  entry_vega: z.number().nullable().optional(),
  entry_iv: z.number().nullable().optional(),
});

export type LegInput = z.infer<typeof LegInputSchema>;
export type StrategyInput = z.infer<typeof StrategyInputSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type CanonicalFill = z.infer<typeof CanonicalFillSchema>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type StrategyPatch = z.infer<typeof StrategyPatchSchema>;
export type LegClosePatch = z.infer<typeof LegClosePatchSchema>;
export type LegCreate = z.infer<typeof LegCreateSchema>;

// --- Marketdata.app -------------------------------------------------------
//
// Marketdata returns COLUMN-oriented JSON: every field is an array, and index i
// across all arrays describes one contract. A single-contract request therefore
// still returns arrays of length 1.
//
// The `s` status field discriminates the three outcomes. `no_data` is the one
// that matters most here: an unknown or malformed option symbol comes back as
// no_data rather than an error, so a bad symbol is only ever visible as an
// absent quote. That is why lib/occ.ts throws on malformed input instead of
// passing it through, and why the client below reports an explicit per-leg
// error rather than dropping the contract.

const NullableNumbers = z.array(z.number().nullable());

export const MarketdataOkSchema = z.object({
  s: z.literal("ok"),
  optionSymbol: z.array(z.string()).min(1),
  /** Unix seconds. Preserved rather than replaced: the free feed is delayed
   *  ~24h, so the real timestamp is what tells the UI how stale a mark is. */
  updated: z.array(z.number()).optional(),
  bid: NullableNumbers.optional(),
  ask: NullableNumbers.optional(),
  mid: NullableNumbers.optional(),
  last: NullableNumbers.optional(),
  iv: NullableNumbers.optional(),
  delta: NullableNumbers.optional(),
  gamma: NullableNumbers.optional(),
  theta: NullableNumbers.optional(),
  vega: NullableNumbers.optional(),
  rho: NullableNumbers.optional(),
  underlyingPrice: NullableNumbers.optional(),
});

export const MarketdataNoDataSchema = z.object({
  s: z.literal("no_data"),
});

export const MarketdataErrorSchema = z.object({
  s: z.literal("error"),
  errmsg: z.string().optional(),
});

export const MarketdataResponseSchema = z.discriminatedUnion("s", [
  MarketdataOkSchema,
  MarketdataNoDataSchema,
  MarketdataErrorSchema,
]);

export type MarketdataOk = z.infer<typeof MarketdataOkSchema>;
export type MarketdataResponse = z.infer<typeof MarketdataResponseSchema>;

/** Stock quote (used for the sandbox spot price). Also column-oriented. */
export const MarketdataStockOkSchema = z.object({
  s: z.literal("ok"),
  symbol: z.array(z.string()).min(1),
  last: NullableNumbers.optional(),
  mid: NullableNumbers.optional(),
  bid: NullableNumbers.optional(),
  ask: NullableNumbers.optional(),
  updated: z.array(z.number()).optional(),
});

export const MarketdataStockResponseSchema = z.discriminatedUnion("s", [
  MarketdataStockOkSchema,
  MarketdataNoDataSchema,
  MarketdataErrorSchema,
]);
