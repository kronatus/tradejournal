"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface DeleteStrategyButtonProps {
  strategyId: string;
}

export function DeleteStrategyButton({ strategyId }: DeleteStrategyButtonProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/strategies/${strategyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete strategy");
      }

      router.push("/trades");
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          disabled={saving}
          className="rounded-md border border-loss/40 bg-loss/10 px-4 py-2 text-sm font-medium text-loss hover:bg-loss/20 disabled:opacity-50"
        >
          Delete strategy
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-loss/40 bg-loss-soft p-4">
          <p className="text-sm text-text">
            Permanently delete this strategy and all its legs? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={saving}
              className="rounded-md border border-loss/40 bg-loss/10 px-4 py-2 text-sm font-medium text-loss hover:bg-loss/20 disabled:opacity-50"
            >
              {saving ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={saving}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error && (
            <div className="rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-xs text-loss">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
