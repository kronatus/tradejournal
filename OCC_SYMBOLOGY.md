# OCC Symbology Guide

How option contracts are encoded throughout this codebase. **Read this before touching anything that handles option symbols.**

## What is OCC Symbology?

OCC (Options Clearing Corporation) symbology is the industry-standard 21-character format for uniquely identifying an option contract. Every options data provider (Tradier, Polygon, IBKR, etc.) uses some variant of it.

## The Format: 21 Characters

```
ROOT     YYMMDD   C/P   STRIKE
└──┬──┘  └──┬──┘  └┬┘   └──┬──┘
  1-6      6       1       8
 chars   digits   char   digits
```

| Component | Length | Description | Example |
|---|---|---|---|
| **Root Symbol** | 1–6 chars | Underlying ticker, uppercase | `SPY`, `AAPL`, `BRK.B` |
| **Expiration** | 6 digits | `YYMMDD` format | `260529` = May 29, 2026 |
| **Option Type** | 1 char | `C` for Call, `P` for Put | `C` |
| **Strike Price** | 8 digits | **Last 3 digits are decimals** | `00755000` = $755.00 |

**Full example:** `SPY260529C00755000` = SPY $755.00 Call expiring May 29, 2026.

---

## ⚠️ Strike Price: The #1 Source of Bugs

The 8-digit strike is **dollars × 1000**, padded with leading zeros. The last 3 digits are decimals.

| Strike Price | Math | OCC Strike Digits |
|---|---|---|
| $755.00 | 755 × 1000 = 755000 | `00755000` |
| $150.50 | 150.5 × 1000 = 150500 | `00150500` |
| $21.50 | 21.5 × 1000 = 21500 | `00021500` |
| $7.00 | 7 × 1000 = 7000 | `00007000` |
| $1,234.56 | 1234.56 × 1000 = 1234560 | `01234560` |

**The position of the zeros matters.** `00075500` is NOT the same as `00755000`:
- `00075500` would be $75.50 (wrong format if you meant $755)
- `00755000` is $755.00 (correct)

---

## Two Formats Used in This Codebase

### 1. Storage Format (our DB) — strike in CENTS

The `legs.occ_symbol` column stores symbols with an `O:` prefix and the strike encoded in **cents** (`strike_dollars × 100`):

```
O:SPY260529C00075500  ← $755.00 stored as 75500 cents
```

This format is constructed by `buildOccSymbol()` in [components/strategy-form.tsx](components/strategy-form.tsx) when a user enters a new trade.

### 2. Tradier API Format — strike in DOLLARS × 1000 (standard OCC)

The Tradier API expects the standard OCC format **without the `O:` prefix** and with strike encoded as `dollars × 1000`:

```
SPY260529C00755000  ← $755.00 encoded as 755000
```

### Why the difference?

The storage format was originally built for Polygon, which uses the `O:` prefix and a slightly non-standard strike encoding. When we migrated to Tradier, we kept the existing storage format and added a conversion layer (`toTradierSymbol`) instead of migrating the DB.

---

## Helper Functions — Use These, Don't Reinvent

All OCC handling lives in [lib/quotes.ts](lib/quotes.ts):

### `parseOccSymbol(occ: string)`
Parses our storage format (with `O:` prefix, cents strike) into components.
```ts
parseOccSymbol("O:SPY260529C00075500")
// → { underlying: "SPY", expiry: "2026-05-29", strike: 755, type: "C" }
```

### `toTradierSymbol(occ: string)` (internal)
Converts storage format → Tradier format. Used by `fetchTradierQuotes`.
```ts
"O:SPY260529C00075500" → "SPY260529C00755000"
```

### `buildOccSymbol(underlying, expiry, strikeCents, optionType)`
Constructs a Tradier-format OCC from components (e.g., when generating symbols server-side).

### Formatting for display: `formatOccSymbol` in [lib/utils.ts](lib/utils.ts)
Renders human-readable: `"SPY 05/29/2026 $755.00 Call"`.

---

## Rules When Adding Code That Touches Option Symbols

1. **Never write a regex to parse OCC by hand.** Use `parseOccSymbol()`.
2. **Never multiply/divide by magic numbers** to convert strike formats. The conversion is always:
   - cents → Tradier: `strike_cents × 10`
   - dollars → Tradier: `strike_dollars × 1000`
   - Tradier → cents: `strike_tradier ÷ 10`
3. **Always pad to 8 digits** with `.padStart(8, "0")`.
4. **When sending to an external API**, convert to that API's expected format first. Don't assume our storage format is universal.
5. **When receiving from an external API**, map response symbols back to the original storage key — don't just key your result map by the external symbol (the caller will look up using the original).

---

## Quick Reference: Round-Trip Through Tradier

```
Stored in DB:     O:SPY260529C00075500   (cents)
   ↓ toTradierSymbol()
Sent to Tradier:  SPY260529C00755000     (dollars × 1000)
   ↓ Tradier responds
Response symbol:  SPY260529C00755000     (Tradier echoes back)
   ↓ map back via tradierToOriginal Map
Stored in result: O:SPY260529C00075500   (original key for lookup)
```

The reverse mapping step is critical — without it, the caller's `.get(leg.occ_symbol)` lookup fails because the keys don't match.

---

## Historical Bug Reference

Phase 5.1 (Tradier migration) hit three bugs in this area, all documented here so future you doesn't repeat them:

1. **Strike format mismatch** — sent cents-encoded strike to Tradier; Tradier returned `unmatched_symbols`. Fixed by `toTradierSymbol()`.
2. **Map key mismatch** — stored response under Tradier's symbol (`O:SPY...755000`); caller looked up under original (`O:SPY...075500`). Fixed by `tradierToOriginal` reverse map.
3. **Zod strict datetime** — Tradier's `greeks.updated_at` failed `z.string().datetime()`. Fixed by ignoring it and using a fresh ISO timestamp.
