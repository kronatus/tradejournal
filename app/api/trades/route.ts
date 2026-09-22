import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { StrategyInputSchema, LegInputSchema } from "@/lib/schemas";
import { parseOccSymbol } from "@/lib/quotes";
import { computeNetGreeks } from "@/lib/snapshots";
import { isQuoteProviderConfigured } from "@/lib/quotes";
import type { Leg } from "@/lib/types";
import { z } from "zod";

type LegWithSide = z.infer<typeof LegInputSchema>;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = StrategyInputSchema.parse(body);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get authenticated user from Authorization header
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();

    const { data: strategy, error: strategyError } = await supabase
      .from("strategies")
      .insert({
        underlying: input.underlying,
        strategy_kind: input.strategy_kind,
        conviction: input.conviction_rating,
        thesis: input.notes || null,
        source: "manual",
        opened_at: input.opened_at,
        user_id: user.id,
      })
      .select()
      .single();

    if (strategyError) throw strategyError;

    const legsToInsert = input.legs.map((leg: LegWithSide) => {
      const parsed = parseOccSymbol(leg.occ_symbol);
      return {
        strategy_id: strategy.id,
        occ_symbol: leg.occ_symbol,
        option_type: parsed.type === "C" ? "call" : "put",
        strike_cents: Math.round(parsed.strike * 100),
        expiry: parsed.expiry,
        side: leg.side === "buy" ? "long" : "short",
        qty: leg.quantity,
        entry_price_cents: leg.entry_price_cents,
        exit_price_cents: leg.exit_price_cents || null,
        entry_at: now,
        exit_at: leg.exit_price_cents ? now : null,
        fees_cents: 0,
      };
    });

    const { data: insertedLegs, error: legsError } = await supabase
      .from("legs")
      .insert(legsToInsert)
      .select();

    if (legsError) throw legsError;

    // Snapshot entry Greeks (best-effort — never fail the trade on provider issues).
    const openLegs = ((insertedLegs as Leg[]) || []).filter(
      (l) => l.exit_price_cents === null
    );
    if (openLegs.length > 0 && isQuoteProviderConfigured()) {
      try {
        const snapshot = await computeNetGreeks(openLegs);
        if (snapshot.hasData) {
          await supabase
            .from("strategies")
            .update({
              entry_net_delta: snapshot.netGreeks.delta,
              entry_net_gamma: snapshot.netGreeks.gamma,
              entry_net_theta: snapshot.netGreeks.theta,
              entry_net_vega: snapshot.netGreeks.vega,
            })
            .eq("id", strategy.id);
        }
      } catch (err) {
        console.warn("[trades] Entry snapshot skipped:", (err as Error).message);
      }
    }

    return NextResponse.json(strategy, { status: 201 });
  } catch (error) {
    console.error("Error creating trade:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
