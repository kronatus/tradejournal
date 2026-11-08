/**
 * Create / revoke the Claude connector secret for the signed-in user.
 *
 * POST   → { id, url }   the full connector URL, shown ONCE (only a hash is kept)
 * DELETE ?id=<uuid>      revoke a token
 *
 * Tokens are inserted here with the service role so the secret never passes
 * through a client-side insert; the browser lists them via RLS (no hash).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminClient, userFromRequest } from "@/lib/server/admin";
import { hashToken, newTokenSecret } from "@/lib/research-store";

const MAX_ACTIVE_TOKENS = 5;

export async function POST(request: NextRequest) {
  try {
    const db = adminClient();
    const user = await userFromRequest(db, request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { label } = z.object({ label: z.string().trim().min(1).max(60).default("Claude") }).parse(body);

    const { count, error: countError } = await db
      .from("mcp_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("revoked_at", null);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
      return NextResponse.json(
        { error: `You already have ${MAX_ACTIVE_TOKENS} active connector URLs — revoke one first.` },
        { status: 409 }
      );
    }

    const secret = newTokenSecret();
    const { data, error } = await db
      .from("mcp_tokens")
      .insert({ user_id: user.id, token_hash: await hashToken(secret), label })
      .select("id, label, created_at")
      .single();
    if (error) throw error;

    const origin = request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("x-forwarded-host")}`
      : request.nextUrl.origin;
    return NextResponse.json({ ...data, url: `${origin}/api/mcp/${secret}` }, { status: 201 });
  } catch (error) {
    console.error("[research/token] create failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = adminClient();
    const user = await userFromRequest(db, request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("id"));
    const { data, error } = await db
      .from("mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ id, revoked: true });
  } catch (error) {
    console.error("[research/token] revoke failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
