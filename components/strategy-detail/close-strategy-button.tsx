"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Leg } from "@/lib/types";

interface CloseStrategyButtonProps {
  strategyId: string;
  closed: boolean;
  legs: Leg[];
}

export function CloseStrategyButton({
  strategyId,
  closed,
  legs,
}: CloseStrategyButtonProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openLegs = legs.filter((leg) => leg.exit_price_cents === null);

  if (closed) return null;

  const handleCloseNow = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ closed_at: new Date().toISOString() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to close strategy");
      }

      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkClose = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      // Close all open legs at $0
      for (const leg of openLegs) {
        const res = await fetch(`/api/legs/${leg.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            exit_price_cents: 0,
            exit_at: new Date().toISOString(),
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(`Failed to close leg ${leg.occ_symbol}: ${data.error}`);
        }
      }

      // Then close the strategy
      const stratRes = await fetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ closed_at: new Date().toISOString() }),
      });

      if (!stratRes.ok) {
        const data = await stratRes.json();
        throw new Error(data.error || "Failed to close strategy");
      }

      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  const handleLeaveOpen = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.access_token}`,
        },
        body: JSON.stringify({ closed_at: new Date().toISOString() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to close strategy");
      }

      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={() => {
          if (openLegs.length === 0) {
            handleCloseNow();
          } else {
            setConfirming(true);
          }
        }}
        disabled={saving}
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        {saving ? "Closing…" : "Mark Closed"}
      </button>

      {confirming && openLegs.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-text-muted">
            This strategy has {openLegs.length} open leg{openLegs.length !== 1 ? "s" : ""}. How would you like to proceed?
          </p>
          <div className="space-y-2">
            <button
              onClick={handleBulkClose}
              disabled={saving}
              className="w-full rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm font-medium text-loss hover:bg-loss/20 disabled:opacity-50"
            >
              {saving ? "Closing legs…" : "Close all legs at $0.00"}
            </button>
            <button
              onClick={handleLeaveOpen}
              disabled={saving}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {saving ? "…" : "Mark closed, leave legs open"}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={saving}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
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
