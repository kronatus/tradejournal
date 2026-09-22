import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { StrategyPatchSchema } from "@/lib/schemas";
import { computeNetGreeks } from "@/lib/snapshots";
import { isQuoteProviderConfigured } from "@/lib/quotes";
import type { Leg } from "@/lib/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Fetch strategy and verify ownership; include closed_at to detect transitions
    const { data: strategy, error: fetchError } = await supabase
      .from("strategies")
      .select("id, user_id, closed_at, legs(*)")
      .eq("id", id)
      .single();

    if (fetchError || !strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    if (strategy.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = StrategyPatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Build patch object — only include provided fields
    const patch: Record<string, unknown> = {};
    if (parsed.data.conviction !== undefined) patch.conviction = parsed.data.conviction;
    if (parsed.data.thesis !== undefined) patch.thesis = parsed.data.thesis;
    if (parsed.data.post_mortem !== undefined) patch.post_mortem = parsed.data.post_mortem;
    if (parsed.data.planned_stop_cents !== undefined)
      patch.planned_stop_cents = parsed.data.planned_stop_cents;
    if (parsed.data.planned_target_cents !== undefined)
      patch.planned_target_cents = parsed.data.planned_target_cents;
    if (parsed.data.collateral_cents !== undefined)
      patch.collateral_cents = parsed.data.collateral_cents;
    if (parsed.data.closed_at !== undefined) patch.closed_at = parsed.data.closed_at;

    // If this PATCH is closing the strategy (null → non-null), snapshot Greeks at close.
    const isClosingNow =
      parsed.data.closed_at != null && strategy.closed_at == null;
    if (isClosingNow) {
      patch.close_net_at = parsed.data.closed_at;
      const allLegs = (strategy.legs as Leg[] | null) ?? [];
      const openLegs = allLegs.filter((l) => l.exit_price_cents === null);
      if (openLegs.length > 0 && isQuoteProviderConfigured()) {
        try {
          const snapshot = await computeNetGreeks(openLegs);
          if (snapshot.hasData) {
            patch.close_net_delta = snapshot.netGreeks.delta;
            patch.close_net_gamma = snapshot.netGreeks.gamma;
            patch.close_net_theta = snapshot.netGreeks.theta;
            patch.close_net_vega = snapshot.netGreeks.vega;
          }
        } catch (err) {
          console.warn(
            "[strategies PATCH] Close snapshot skipped:",
            (err as Error).message
          );
        }
      }
    }

    // Perform the update
    const { data: updated, error: updateError } = await supabase
      .from("strategies")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Update failed: ${updateError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error patching strategy:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const { data: strategy, error: fetchError } = await supabase
      .from("strategies")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (fetchError || !strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    if (strategy.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("strategies")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: `Delete failed: ${deleteError.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting strategy:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
