import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LegCreateSchema } from "@/lib/schemas";
import { parseOccSymbol } from "@/lib/quotes";

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const { strategy_id, ...legData } = body;

    if (!strategy_id) {
      return NextResponse.json(
        { error: "strategy_id is required" },
        { status: 400 }
      );
    }

    // Verify strategy ownership
    const { data: strategy, error: strategyError } = await supabase
      .from("strategies")
      .select("id, user_id")
      .eq("id", strategy_id)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    if (strategy.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const parsed = LegCreateSchema.safeParse(legData);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Extract strike from OCC symbol
    let strikeCents = 0;
    try {
      const occParsed = parseOccSymbol(parsed.data.occ_symbol);
      strikeCents = Math.round(occParsed.strike * 100);
    } catch (e) {
      // Should not happen since OccSymbolSchema validated it
      console.error("Failed to parse OCC symbol:", e);
    }

    // Extract expiry from OCC symbol
    let expiry = "";
    try {
      const occParsed = parseOccSymbol(parsed.data.occ_symbol);
      expiry = occParsed.expiry;
    } catch (e) {
      console.error("Failed to parse OCC symbol for expiry:", e);
    }

    // Build leg insert object
    const legInsert: Record<string, unknown> = {
      strategy_id,
      occ_symbol: parsed.data.occ_symbol,
      option_type: parsed.data.option_type,
      strike_cents: strikeCents,
      expiry: expiry,
      side: parsed.data.side,
      qty: parsed.data.qty,
      entry_price_cents: parsed.data.entry_price_cents,
      entry_at: parsed.data.entry_at,
      fees_cents: parsed.data.fees_cents ?? 0,
      exit_price_cents: null,
      exit_at: null,
    };

    if (parsed.data.entry_delta !== undefined)
      legInsert.entry_delta = parsed.data.entry_delta;
    if (parsed.data.entry_gamma !== undefined)
      legInsert.entry_gamma = parsed.data.entry_gamma;
    if (parsed.data.entry_theta !== undefined)
      legInsert.entry_theta = parsed.data.entry_theta;
    if (parsed.data.entry_vega !== undefined)
      legInsert.entry_vega = parsed.data.entry_vega;
    if (parsed.data.entry_iv !== undefined)
      legInsert.entry_iv = parsed.data.entry_iv;

    // Insert the leg
    const { data: newLeg, error: insertError } = await supabase
      .from("legs")
      .insert(legInsert)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: `Insert failed: ${insertError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(newLeg, { status: 201 });
  } catch (error) {
    console.error("Error creating leg:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
