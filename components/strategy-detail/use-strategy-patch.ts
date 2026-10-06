"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/** PATCHes one strategy and refreshes the server data. Shared by every inline editor. */
export function useStrategyPatch(strategyId: string) {
  const router = useRouter();
  const { session } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (!session?.access_token) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update strategy");
      }
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { save, saving, error, clearError: () => setError(null) };
}
