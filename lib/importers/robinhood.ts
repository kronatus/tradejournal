import Papa from "papaparse";
import { CanonicalFill, CanonicalFillSchema } from "../schemas";
import { ImportResult, SkippedRow } from "./index";

const OPTION_CODES = new Set(["BTO", "STO", "BTC", "STC", "OEXP"]);

const DESCRIPTION_REGEX =
  /^([A-Z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$([0-9,.]+)/i;

interface ParsedDescription {
  underlying: string;
  expiry: string;
  optionType: "call" | "put";
  strikeCents: number;
}

function parseDescription(
  desc: string,
  transCode: string
): ParsedDescription | null {
  let cleanDesc = desc;

  if (transCode === "OEXP") {
    cleanDesc = desc.replace(/^Option Expiration for /, "");
  }

  const match = cleanDesc.match(DESCRIPTION_REGEX);
  if (!match) {
    return null;
  }

  const underlying = match[1].toUpperCase();
  const dateStr = match[2];
  const optionTypeStr = match[3].toLowerCase();
  const strikeStr = match[4];

  const [month, day, year] = dateStr.split("/");
  const expiry = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const strikeCents = Math.round(parseFloat(strikeStr.replace(/,/g, "")) * 100);

  return {
    underlying,
    expiry,
    optionType: optionTypeStr as "call" | "put",
    strikeCents,
  };
}

interface TransCodeResult {
  action: "open" | "close";
  side: "long" | "short";
}

function parseTransCode(code: string, rawQty: string): TransCodeResult | null {
  switch (code) {
    case "BTO":
      return { action: "open", side: "long" };
    case "STO":
      return { action: "open", side: "short" };
    case "BTC":
      return { action: "close", side: "long" };
    case "STC":
      return { action: "close", side: "short" };
    case "OEXP":
      const hasSuffix = rawQty.endsWith("S");
      return {
        action: "close",
        side: hasSuffix ? "short" : "long",
      };
    default:
      return null;
  }
}

function parseQty(s: string): number {
  return parseInt(s.replace(/S$/, ""), 10);
}

function parseMoney(s: string): number {
  if (!s || s.trim() === "") return 0;

  const cleaned = s.replace(/[\s$(),]/g, "");
  const value = parseFloat(cleaned);

  if (isNaN(value)) return 0;

  const isNegative = s.includes("(") && s.includes(")");
  return Math.round(value * 100 * (isNegative ? -1 : 1));
}

export function parse(csvText: string): ImportResult {
  const fills: CanonicalFill[] = [];
  const skipped: SkippedRow[] = [];
  let rowIndex = 0;

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    step(row) {
      rowIndex++;
      const rowData = row.data as Record<string, unknown>;

      const activityDate = (rowData["Activity Date"] || "").toString().trim();
      const description = (rowData["Description"] || "").toString().trim();
      const transCode = (rowData["Trans Code"] || "").toString().trim();
      const quantity = (rowData["Quantity"] || "").toString().trim();
      const price = (rowData["Price"] || "").toString().trim();
      const amount = (rowData["Amount"] || "").toString().trim();

      // Skip if description has newlines (stock delivery row)
      if (description.includes("\n")) {
        skipped.push({
          rowIndex,
          reason: "Multi-line description (stock delivery)",
        });
        return;
      }

      // Skip if CUSIP in description (stock delivery)
      if (description.includes("CUSIP")) {
        skipped.push({
          rowIndex,
          reason: "Stock delivery row (CUSIP)",
        });
        return;
      }

      // Skip footer row
      if (description.startsWith("The data provided")) {
        return; // Silently ignore footer
      }

      // Skip if trans code is empty (leftover empty row)
      if (!transCode || transCode.trim() === "") {
        return; // Silently ignore
      }

      // Skip if trans code not in option codes
      if (!OPTION_CODES.has(transCode)) {
        skipped.push({
          rowIndex,
          reason: `Unsupported trans code: ${transCode}`,
        });
        return;
      }

      try {
        // Parse description
        const parsed = parseDescription(description, transCode);
        if (!parsed) {
          skipped.push({
            rowIndex,
            reason: "Could not parse description format",
          });
          return;
        }

        // Parse trans code
        const transResult = parseTransCode(transCode, quantity);
        if (!transResult) {
          skipped.push({
            rowIndex,
            reason: `Unknown trans code: ${transCode}`,
          });
          return;
        }

        // Parse quantity
        const qty = parseQty(quantity);

        // Parse price (0 for OEXP)
        let priceCents = 0;
        if (transCode === "OEXP") {
          priceCents = 0;
        } else {
          priceCents = parseMoney(price);
        }

        // Parse amount
        const amountCents = parseMoney(amount);

        // Calculate fees
        let feesCents = 0;
        if (transCode !== "OEXP") {
          const grossCents = Math.abs(priceCents * qty * 100);
          const netCents = Math.abs(amountCents);
          feesCents = Math.round(Math.abs(grossCents - netCents));
        }

        // Parse activity date
        const [month, day, year] = activityDate.split("/");
        const filledAt = new Date(
          Number(year),
          Number(month) - 1,
          Number(day)
        );

        // Build external_fill_id (include rowIndex to ensure uniqueness even for duplicate rows)
        const externalFillId = `${activityDate}|${transCode}|${parsed.underlying}|${parsed.expiry}|${parsed.optionType}|${parsed.strikeCents}|${qty}|${priceCents}|${rowIndex}`;

        const fill: CanonicalFill = {
          external_fill_id: externalFillId,
          external_group_ref: null,
          filled_at: filledAt,
          underlying: parsed.underlying,
          option_type: parsed.optionType,
          strike_cents: parsed.strikeCents,
          expiry: parsed.expiry,
          side: transResult.side,
          action: transResult.action,
          qty,
          price_cents: priceCents,
          fees_cents: feesCents,
        };

        // Validate against schema
        const validated = CanonicalFillSchema.safeParse(fill);
        if (!validated.success) {
          skipped.push({
            rowIndex,
            reason: `Schema validation failed: ${validated.error.errors[0].message}`,
          });
          return;
        }

        fills.push(validated.data);
      } catch (error) {
        skipped.push({
          rowIndex,
          reason: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    error(error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`CSV parse error: ${message}`);
    },
  });

  return { fills, skipped };
}
