import { CanonicalFill, CanonicalFillSchema } from "../schemas";
import { ImportResult, SkippedRow } from "./index";
import Papa from "papaparse";

// Generic broker parser: accepts any CSV with columns that user maps
export function parse(
  csvText: string,
  columnMapping?: Record<string, string>
): ImportResult {
  if (!columnMapping) {
    return { fills: [], skipped: [] };
  }

  const result = Papa.parse(csvText, { header: true, dynamicTyping: false });
  const fills: CanonicalFill[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 0; i < (result.data as Record<string, unknown>[]).length; i++) {
    const row = (result.data as Record<string, unknown>[])[i];
    if (!row || Object.keys(row).length === 0) continue;

    try {
      // Map CSV row using columnMapping
      const mapped: Record<string, string> = {};
      for (const [csvCol, field] of Object.entries(columnMapping)) {
        const val = row[csvCol];
        if (val !== undefined && val !== null) {
          mapped[field] = String(val);
        }
      }

      // Coerce types
      const fill: CanonicalFill = {
        external_fill_id: mapped.external_fill_id || `${i}`,
        external_group_ref: mapped.external_group_ref ?? null,
        filled_at: new Date(mapped.filled_at),
        underlying: (mapped.underlying || "").toUpperCase(),
        option_type: (mapped.option_type || "").toLowerCase() === "put" ? "put" : "call",
        strike_cents: Math.round(parseFloat(mapped.strike_cents || "0") * 100),
        expiry: mapped.expiry || "",
        side: (mapped.side || "").toLowerCase() === "short" ? "short" : "long",
        action: (mapped.action || "").toLowerCase() === "close" ? "close" : "open",
        qty: parseInt(mapped.qty || "0"),
        price_cents: Math.round(parseFloat(mapped.price_cents || "0") * 100),
        fees_cents: Math.round(parseFloat(mapped.fees_cents || "0") * 100),
      };

      const validated = CanonicalFillSchema.parse(fill);
      fills.push(validated);
    } catch (e) {
      skipped.push({
        rowIndex: i,
        reason: `Failed to parse: ${(e as Error).message}`,
      });
    }
  }

  return { fills, skipped };
}
