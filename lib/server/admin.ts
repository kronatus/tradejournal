/**
 * Server-only helpers shared by the research/market API routes.
 * The service-role client bypasses RLS: callers must scope by user_id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured (URL / service role key)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in user behind an `Authorization: Bearer <access token>` header. */
export async function userFromRequest(
  db: SupabaseClient,
  request: Request
): Promise<{ id: string } | null> {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}
