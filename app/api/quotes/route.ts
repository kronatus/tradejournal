import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeNetGreeksFromTradier } from "@/lib/snapshots";
import { Leg, Strategy } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const strategyId = request.nextUrl.searchParams.get("strategyId");
    if (!strategyId) {
      return NextResponse.json(
        { error: "strategyId query param required" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: strategy, error: strategyError } = await supabase
      .from("strategies")
      .select("*, legs(*)")
      .eq("id", strategyId)
      .eq("user_id", user.id)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    const typedStrategy = strategy as Strategy & { legs: Leg[] };
    const legs = typedStrategy.legs || [];
    const openLegs = legs.filter((leg) => leg.exit_price_cents === null);

    if (openLegs.length === 0) {
      return NextResponse.json({
        currentValueCents: 0,
        netGreeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
        perLeg: [],
        minValueCents: typedStrategy.min_value_cents,
        maxValueCents: typedStrategy.max_value_cents,
        fetchedAt: new Date().toISOString(),
      });
    }

    const snapshot = await computeNetGreeksFromTradier(
      openLegs,
      process.env.TRADIER_API_TOKEN!
    );

    let minValueCents = typedStrategy.min_value_cents;
    let maxValueCents = typedStrategy.max_value_cents;

    if (snapshot.hasData) {
      if (minValueCents === null || snapshot.currentValueCents < minValueCents) {
        minValueCents = snapshot.currentValueCents;
      }
      if (maxValueCents === null || snapshot.currentValueCents > maxValueCents) {
        maxValueCents = snapshot.currentValueCents;
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("strategies")
        .update({
          min_value_cents: minValueCents,
          max_value_cents: maxValueCents,
          current_net_delta: snapshot.netGreeks.delta,
          current_net_gamma: snapshot.netGreeks.gamma,
          current_net_theta: snapshot.netGreeks.theta,
          current_net_vega: snapshot.netGreeks.vega,
          current_net_at: nowIso,
        })
        .eq("id", strategyId);
      if (updateError) {
        console.error("[Quotes] Failed to persist snapshot:", updateError.message);
      }
    }

    return NextResponse.json({
      currentValueCents: snapshot.currentValueCents,
      netGreeks: snapshot.netGreeks,
      perLeg: snapshot.perLeg,
      minValueCents,
      maxValueCents,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching quotes:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
