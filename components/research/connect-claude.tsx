"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useUserQuery } from "@/lib/use-user-query";
import { formatDateTime } from "@/lib/utils";
import { PROMPTS } from "@/lib/research";
import type { McpToken } from "@/lib/types";
import { Card, CopyButton } from "./ui";

async function listTokens(): Promise<McpToken[]> {
  const { data, error } = await supabaseBrowser
    .from("mcp_tokens")
    .select("id, user_id, label, created_at, last_used_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as McpToken[];
}

/**
 * Generates the custom-connector URL Claude chat uses to reach this app.
 * The URL embeds a secret shown exactly once; only its hash is stored.
 */
export function ConnectClaude({ onClose }: { onClose?: () => void }) {
  const { session } = useAuth();
  const [version, setVersion] = useState(0);
  const { data: tokens, error: loadError } = useUserQuery(listTokens, [version]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const auth = { Authorization: `Bearer ${session?.access_token ?? ""}` };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research/token", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Claude" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setFresh(body.url);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this connector URL? Claude will lose access until you add a new one.")) return;
    const res = await fetch(`/api/research/token?id=${id}`, { method: "DELETE", headers: auth });
    if (!res.ok) setError((await res.json()).error ?? "Revoke failed");
    setVersion((v) => v + 1);
  };

  return (
    <Card
      title="Connect Claude"
      action={
        onClose && (
          <button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-text">
            Close
          </button>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-text-muted">
          Claude chat does the analysis (with your Robinhood connector and web search) and writes it
          here through a private connector URL.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-text-muted">
          <li>Generate a connector URL below and copy it — it is shown only once.</li>
          <li>
            In claude.ai: <span className="text-text">Settings → Connectors → Add custom connector</span>,
            paste the URL.
          </li>
          <li>
            Upload the <code className="font-mono text-xs">market-sweep</code> and{" "}
            <code className="font-mono text-xs">ticker-research</code> skills (see{" "}
            <code className="font-mono text-xs">skills/README.md</code>).
          </li>
          <li>
            Ask Claude: <code className="font-mono text-xs">{PROMPTS.sweep}</code>
          </li>
        </ol>

        {fresh && (
          <div className="space-y-2 rounded-md border border-warn/40 bg-warn-soft p-3">
            <p className="text-xs font-medium text-warn">
              Copy this now — it will not be shown again. Anyone with it can read and write your research.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs">{fresh}</code>
              <CopyButton text={fresh} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={create}
            disabled={busy || !session}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate connector URL"}
          </button>
          {(error || loadError) && <span className="text-xs text-loss">{error ?? loadError}</span>}
        </div>

        {tokens && tokens.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="text-text-subtle">
                    {" "}
                    · created {formatDateTime(t.created_at)} · last used{" "}
                    {t.last_used_at ? formatDateTime(t.last_used_at) : "never"}
                  </span>
                </span>
                <button type="button" onClick={() => revoke(t.id)} className="text-text-muted hover:text-loss">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
