"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

type QueryState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

type Settled<T> = { key: string; data: T | null; error: string | null };

/**
 * Runs `fetcher` as the logged-in user. The session lives in the browser, so
 * the fetcher must use `supabaseBrowser` (anon key + the user's JWT): row-level
 * security then limits every read to that user's rows. Never use the
 * service-role client for reads.
 */
export function useUserQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): QueryState<T> {
  const { user } = useAuth();
  const userId = user?.id;
  // Results are tagged with the user + deps they were fetched for, so a stale
  // result (e.g. the previous user's) is never shown after a login change.
  const key = JSON.stringify([userId, ...deps]);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetcher()
      .then((data) => {
        if (!cancelled) setSettled({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSettled({
            key,
            data: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!settled || settled.key !== key) {
    return { data: null, error: null, loading: true };
  }
  return { data: settled.data, error: settled.error, loading: false };
}
