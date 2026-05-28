import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LegClosePatchSchema } from "@/lib/schemas";

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

    // Fetch leg with its strategy user_id for ownership check
    const { data: leg, error: fetchError } = await supabase
      .from("legs")
      .select("*, strategies!inner(user_id)")
      .eq("id", id)
      .single();

    if (fetchError || !leg) {
      return NextResponse.json({ error: "Leg not found" }, { status: 404 });
    }

    // Ownership check via strategy
    const strategy = leg.strategies as { user_id: string };
    if (strategy.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Guard: check if leg is already closed
    if (leg.exit_price_cents != null) {
      return NextResponse.json(
        { error: "Leg is already closed" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = LegClosePatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Build patch object
    const patch: Record<string, unknown> = {
      exit_price_cents: parsed.data.exit_price_cents,
      exit_at: parsed.data.exit_at,
    };
    if (parsed.data.exit_delta !== undefined) patch.exit_delta = parsed.data.exit_delta;
    if (parsed.data.exit_gamma !== undefined) patch.exit_gamma = parsed.data.exit_gamma;
    if (parsed.data.exit_theta !== undefined) patch.exit_theta = parsed.data.exit_theta;
    if (parsed.data.exit_vega !== undefined) patch.exit_vega = parsed.data.exit_vega;
    if (parsed.data.exit_iv !== undefined) patch.exit_iv = parsed.data.exit_iv;

    // Perform the update
    const { data: updated, error: updateError } = await supabase
      .from("legs")
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
    console.error("Error closing leg:", error);
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

    const { data: leg, error: fetchError } = await supabase
      .from("legs")
      .select("id, strategy_id, strategies!inner(user_id)")
      .eq("id", id)
      .single();

    if (fetchError || !leg) {
      return NextResponse.json({ error: "Leg not found" }, { status: 404 });
    }

    const strategy = leg.strategies as unknown as { user_id: string };
    if (strategy.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Guard: refuse to delete the only leg of a strategy
    const { count, error: countError } = await supabase
      .from("legs")
      .select("id", { count: "exact", head: true })
      .eq("strategy_id", leg.strategy_id);

    if (countError) {
      return NextResponse.json(
        { error: `Count failed: ${countError.message}` },
        { status: 500 }
      );
    }

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only leg in a strategy. Delete the strategy instead." },
        { status: 400 }
      );
    }

    const { error: deleteError } = await supabase
      .from("legs")
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
    console.error("Error deleting leg:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
