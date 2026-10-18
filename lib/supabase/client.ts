"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Untyped on purpose: the hand-written `Database` type in ../types resolves
// table rows to `never`; callers cast to Strategy/Leg as the pages always did.
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );
}

// For use in Client Components
export const supabaseBrowser = createClient();
