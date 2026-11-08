"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/protected-route";
import { ScanView } from "@/components/pulse/scan-view";
import { SweepView } from "@/components/pulse/sweep-view";
import { PromptHandoff } from "@/components/research/ui";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useUserQuery } from "@/lib/use-user-query";
import { PROMPTS } from "@/lib/research";
import { formatDateTime } from "@/lib/utils";
import type { SweepPick } from "@/lib/schemas";
import type { MarketScanRow, MarketSweep } from "@/lib/types";

async function loadPulse(scanDate: string | null) {
  const [dates, scan, sweeps, research] = await Promise.all([
    supabaseBrowser.from("market_scans").select("scan_date").order("scan_date", { ascending: false }).limit(60),
    (scanDate
      ? supabaseBrowser.from("market_scans").select("*").eq("scan_date", scanDate)
      : supabaseBrowser.from("market_scans").select("*").order("scan_date", { ascending: false }).limit(1)
    ).maybeSingle(),
    supabaseBrowser.from("market_sweeps").select("*").order("created_at", { ascending: false }).limit(20),
    supabaseBrowser.from("research_tickers").select("symbol"),
  ]);
  for (const r of [dates, scan, sweeps, research]) if (r.error) throw r.error;
  return {
    dates: ((dates.data ?? []) as { scan_date: string }[]).map((d) => d.scan_date),
    scan: scan.data as MarketScanRow | null,
    sweeps: (sweeps.data ?? []) as MarketSweep[],
    research: new Set(((research.data ?? []) as { symbol: string }[]).map((r) => r.symbol)),
  };
}

export default function PulsePage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="py-12 text-center">Loading...</div>}>
        <PulseContent />
      </Suspense>
    </ProtectedRoute>
  );
}

function PulseContent() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scanDate = params.get("date");
  const [version, setVersion] = useState(0);
  const [sweepId, setSweepId] = useState<string | null>(null);
  const { data, error, loading } = useUserQuery(() => loadPulse(scanDate), [scanDate, version]);

  if (loading) return <div className="py-12 text-center">Loading...</div>;
  if (error || !data) {
    return (
      <div className="py-12 text-center text-loss">
        Failed to load: {error}
        <p className="mt-2 text-sm text-text-muted">
          If this mentions a missing relation, migration 0007_research.sql has not been applied yet.
        </p>
      </div>
    );
  }

  // Default to the sweep built on the scan being viewed, else the newest one.
  const sweep =
    data.sweeps.find((s) => s.id === sweepId) ??
    (scanDate ? data.sweeps.find((s) => s.scan_date === scanDate) : undefined) ??
    data.sweeps[0] ??
    null;

  const addPick = async (pick: SweepPick) => {
    if (!user) return;
    const { universeEntry } = await import("@/lib/universe");
    const u = universeEntry(pick.symbol);
    const { error: insertError } = await supabaseBrowser.from("research_tickers").upsert(
      {
        user_id: user.id,
        symbol: pick.symbol,
        sector: pick.sector ?? u?.sector ?? null,
        industry: u?.sub_industry ?? null,
        added_by: "claude",
        notes: pick.thesis,
      },
      { onConflict: "user_id,symbol", ignoreDuplicates: true }
    );
    if (insertError) alert(`Could not add ${pick.symbol}: ${insertError.message}`);
    setVersion((v) => v + 1);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Market Pulse</h1>
          <p className="mt-1 text-sm text-text-muted">
            What moved the S&amp;P 500 and Nasdaq-100, and what Claude makes of it.
          </p>
        </div>
        <PromptHandoff prompt={PROMPTS.sweep} hint="Ask Claude:" />
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Claude&apos;s read</h2>
          {data.sweeps.length > 1 && (
            <select
              value={sweep?.id ?? ""}
              onChange={(e) => setSweepId(e.target.value)}
              aria-label="Choose a sweep"
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              {data.sweeps.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDateTime(s.as_of)} — {s.headline.slice(0, 60)}
                </option>
              ))}
            </select>
          )}
        </div>
        {sweep ? (
          <SweepView sweep={sweep} researchSymbols={data.research} onAdd={addPick} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-text-muted">
            No sweep yet. Claude reads the scan below, digs into the standouts with Robinhood and the
            news, and posts its take here.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            Market data{data.scan ? ` · ${data.scan.scan_date}` : ""}
          </h2>
          {data.dates.length > 0 && (
            <select
              value={data.scan?.scan_date ?? ""}
              onChange={(e) => router.push(`${pathname}?date=${e.target.value}`)}
              aria-label="Choose a session"
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              {data.dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
        {data.scan ? (
          <ScanView digest={data.scan.digest} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-text-muted">
            No market data yet. It arrives after the daily ingest runs (needs MASSIVE_API_KEY) or the
            backfill script — see the setup checklist in skills/README.md.
          </div>
        )}
      </section>
    </div>
  );
}
