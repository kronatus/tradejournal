import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getParser, BrokerType } from "@/lib/importers";
import { parse as genericParse } from "@/lib/importers/generic";
import { groupFillsIntoStrategies } from "@/lib/importers/group";
import { CanonicalFill } from "@/lib/schemas";

function groupByUnderlyingExpiry(
  fills: CanonicalFill[]
): Map<string, CanonicalFill[]> {
  const grouped = new Map<string, CanonicalFill[]>();
  for (const fill of fills) {
    const key = `${fill.underlying}|${fill.expiry}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(fill);
  }
  return grouped;
}

export async function POST(request: NextRequest) {
  try {
    // Auth
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse CSV
    const formData = await request.formData();
    const csvFile = formData.get("csv") as File;
    const broker = formData.get("broker") as BrokerType;
    const columnMapping = formData.get("columnMapping")
      ? JSON.parse(formData.get("columnMapping") as string)
      : undefined;

    if (!csvFile) {
      return NextResponse.json(
        { error: "Missing CSV file" },
        { status: 400 }
      );
    }

    const csvText = await csvFile.text();
    const { fills, skipped } =
      broker === "generic"
        ? genericParse(csvText, columnMapping)
        : getParser(broker)(csvText);

    // For Robinhood, group by underlying + expiry; for others, use default grouping
    let filledStrategies: Array<{ fills: CanonicalFill[] }> = [];
    if (broker === "robinhood") {
      const grouped = groupByUnderlyingExpiry(fills);
      filledStrategies = Array.from(grouped.values()).map((fills) => ({
        fills,
      }));
    } else {
      filledStrategies = groupFillsIntoStrategies(fills).map((strategy) => ({
        fills: [...strategy.openLegs, ...strategy.closeLegs],
      }));
    }

    // Persist to database
    let createdStrategyCount = 0;
    let createdLegCount = 0;
    const unmatchedCloses: Array<{
      fill: CanonicalFill;
      reason: string;
    }> = [];

    for (const strategyGroup of filledStrategies) {
      const groupFills = strategyGroup.fills;
      if (groupFills.length === 0) continue;

      // Determine group key for dedup
      const firstFill = groupFills[0]!;
      const externalGroupRef = `${firstFill.underlying}|${firstFill.expiry}`;

      // Check for existing strategy with this external_group_ref
      const { data: existingStrategy } = await supabase
        .from("strategies")
        .select("id")
        .eq("user_id", user.id)
        .eq("external_group_ref", externalGroupRef)
        .maybeSingle();

      if (existingStrategy) {
        continue; // Skip duplicate
      }

      // Separate open and close fills
      const openFills = groupFills.filter((f) => f.action === "open");
      const closeFills = groupFills.filter((f) => f.action === "close");

      // Find earliest open fill date and latest close fill date
      const openedAt = openFills.length
        ? new Date(
            Math.min(
              ...openFills.map((f) => new Date(f.filled_at).getTime())
            )
          )
        : groupFills[0]!.filled_at;

      const closedAt =
        closeFills.length && openFills.length === 0 &&
        closeFills.every((cf) => {
          const matchingOpen = openFills.find(
            (of) =>
              of.underlying === cf.underlying &&
              of.expiry === cf.expiry &&
              of.option_type === cf.option_type &&
              of.strike_cents === cf.strike_cents
          );
          return !matchingOpen;
        })
          ? new Date(
              Math.max(
                ...closeFills.map((f) => new Date(f.filled_at).getTime())
              )
            )
          : null;

      // Insert strategy
      const { data: strategy, error: strategyError } = await supabase
        .from("strategies")
        .insert({
          user_id: user.id,
          underlying: firstFill.underlying,
          source: "csv_import",
          strategy_kind: "custom",
          opened_at: openedAt.toISOString(),
          closed_at: closedAt?.toISOString() || null,
          external_group_ref: externalGroupRef,
        })
        .select()
        .single();

      if (strategyError) {
        console.error("Strategy insert error:", strategyError);
        continue;
      }

      createdStrategyCount++;

      // Insert open fills as legs
      const insertedLegs: Map<
        string,
        { id: string; occ_symbol: string }
      > = new Map();

      for (const openFill of openFills) {
        const occSymbol = `O:${openFill.underlying}${String(openFill.expiry.slice(2, 4))}${openFill.expiry.slice(5, 7)}${openFill.expiry.slice(8, 10)}${openFill.option_type[0]!.toUpperCase()}${String(openFill.strike_cents).padStart(8, "0")}`;

        const { data: leg, error: legError } = await supabase
          .from("legs")
          .insert({
            strategy_id: strategy.id,
            occ_symbol: occSymbol,
            option_type: openFill.option_type,
            strike_cents: openFill.strike_cents,
            expiry: openFill.expiry,
            side: openFill.side,
            qty: openFill.qty,
            entry_price_cents: openFill.price_cents,
            entry_at: openFill.filled_at.toISOString(),
            fees_cents: openFill.fees_cents,
            exit_price_cents: null,
            external_open_fill_id: openFill.external_fill_id,
          })
          .select()
          .single();

        if (legError) {
          console.error("Leg insert error:", legError);
          continue;
        }

        createdLegCount++;
        insertedLegs.set(occSymbol, {
          id: leg.id,
          occ_symbol: occSymbol,
        });
      }

      // Match close fills to legs
      for (const closeFill of closeFills) {
        const occSymbol = `O:${closeFill.underlying}${String(closeFill.expiry.slice(2, 4))}${closeFill.expiry.slice(5, 7)}${closeFill.expiry.slice(8, 10)}${closeFill.option_type[0]!.toUpperCase()}${String(closeFill.strike_cents).padStart(8, "0")}`;

        const matchingLeg = insertedLegs.get(occSymbol);
        if (matchingLeg) {
          await supabase
            .from("legs")
            .update({
              exit_price_cents: closeFill.price_cents,
              exit_at: closeFill.filled_at.toISOString(),
              external_close_fill_id: closeFill.external_fill_id,
            })
            .eq("id", matchingLeg.id);
        } else {
          unmatchedCloses.push({
            fill: closeFill,
            reason: `No matching open leg for ${closeFill.underlying} ${closeFill.expiry} ${closeFill.option_type} ${closeFill.strike_cents}`,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        fillCount: fills.length,
        strategyCount: createdStrategyCount,
        legCount: createdLegCount,
        skippedCount: skipped.length,
        unmatchedCloses: unmatchedCloses.length,
      },
      skipped,
      unmatchedCloses,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
