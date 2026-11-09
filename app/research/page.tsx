"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/protected-route";
import { TickerSidebar } from "@/components/research/ticker-sidebar";
import { TickerReportView } from "@/components/research/ticker-report-view";
import { ConnectClaude } from "@/components/research/connect-claude";
import { CopyButton } from "@/components/research/ui";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useUserQuery } from "@/lib/use-user-query";
import { DEFAULT_GROUPING, GROUPINGS, PROMPTS } from "@/lib/research";
import type { TickerWithStatus } from "@/lib/research-store";
import type { ResearchTicker, StrategySet, TickerReport } from "@/lib/types";

const GROUPING_KEY = "research.grouping";

async function loadTickers(): Promise<{ tickers: TickerWithStatus[]; loadedAt: number }> {
  const [tickers, reports] = await Promise.all([
    supabaseBrowser
      .from("research_tickers")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("symbol", { ascending: true }),
    supabaseBrowser
      .from("ticker_reports")
      .select("symbol, as_of")
      .order("as_of", { ascending: false })
      .limit(1000),
  ]);
  if (tickers.error) throw tickers.error;
  if (reports.error) throw reports.error;
  const latest = new Map<string, string>();
  for (const r of (reports.data ?? []) as { symbol: string; as_of: string }[]) {
    if (!latest.has(r.symbol)) latest.set(r.symbol, r.as_of);
  }
  return {
    tickers: ((tickers.data ?? []) as ResearchTicker[]).map((t) => ({
      ...t,
      latest_report_at: latest.get(t.symbol) ?? null,
    })),
    loadedAt: Date.now(),
  };
}

async function latestRow<T>(table: "ticker_reports" | "strategy_sets", symbol: string): Promise<T | null> {
  const { data, error } = await supabaseBrowser
    .from(table)
    .select("*")
    .eq("symbol", symbol)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as T | null;
}

/** The latest report and, separately, the latest options strategy set. */
async function loadReport(
  symbol: string | null
): Promise<{ report: TickerReport | null; strategies: StrategySet | null } | null> {
  if (!symbol) return null;
  const [report, strategies] = await Promise.all([
    latestRow<TickerReport>("ticker_reports", symbol),
    // A missing table (migration 0009 not applied yet) must not hide the report.
    latestRow<StrategySet>("strategy_sets", symbol).catch(() => null),
  ]);
  return { report, strategies };
}

function readGrouping(): string {
  try {
    const g = localStorage.getItem(GROUPING_KEY);
    return g && GROUPINGS[g] ? g : DEFAULT_GROUPING;
  } catch {
    return DEFAULT_GROUPING;
  }
}

export default function ResearchPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<div className="py-12 text-center">Loading...</div>}>
        <ResearchContent />
      </Suspense>
    </ProtectedRoute>
  );
}

function ResearchContent() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [version, setVersion] = useState(0);
  const [grouping, setGrouping] = useState(readGrouping);
  const [showConnect, setShowConnect] = useState(false);
  const [showList, setShowList] = useState(false);

  const list = useUserQuery(loadTickers, [version]);
  const tickers = list.data?.tickers ?? [];
  const selected = params.get("symbol")?.toUpperCase() ?? tickers[0]?.symbol ?? null;
  const report = useUserQuery(() => loadReport(selected), [selected, version]);

  const select = (symbol: string) => {
    setShowList(false);
    router.push(`${pathname}?symbol=${encodeURIComponent(symbol)}`);
  };

  const addTicker = async (symbol: string): Promise<string | null> => {
    if (!user) return "Not signed in";
    if (tickers.some((t) => t.symbol === symbol)) {
      select(symbol);
      return null;
    }
    // Loaded on demand so the ~130 KB universe file stays out of the page bundle.
    const { universeEntry } = await import("@/lib/universe");
    const u = universeEntry(symbol);
    const { error } = await supabaseBrowser.from("research_tickers").insert({
      user_id: user.id,
      symbol,
      sector: u?.sector ?? null,
      industry: u?.sub_industry ?? null,
      added_by: "user",
    });
    if (error) return error.message;
    setVersion((v) => v + 1);
    select(symbol);
    return null;
  };

  const removeTicker = async (symbol: string) => {
    const { error } = await supabaseBrowser.from("research_tickers").delete().eq("symbol", symbol);
    if (error) {
      alert(`Could not remove ${symbol}: ${error.message}`);
      return;
    }
    setVersion((v) => v + 1);
    if (selected === symbol) router.push(pathname);
  };

  const changeGrouping = (g: string) => {
    setGrouping(g);
    try {
      localStorage.setItem(GROUPING_KEY, g);
    } catch {
      // Private mode etc.: the choice just won't persist.
    }
  };

  if (list.loading) return <div className="py-12 text-center">Loading...</div>;
  if (list.error) {
    return (
      <div className="py-12 text-center text-loss">
        Failed to load: {list.error}
        <p className="mt-2 text-sm text-text-muted">
          If this mentions a missing relation, migration 0007_research.sql has not been applied yet.
        </p>
      </div>
    );
  }

  const selectedTicker = tickers.find((t) => t.symbol === selected) ?? null;
  const now = list.data?.loadedAt ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Research</h1>
          <p className="mt-1 text-sm text-text-muted">
            Your watchlist, analysed by Claude from Robinhood data and the latest news.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tickers.length > 0 && (
            <span className="flex items-center gap-2 text-xs text-text-muted">
              <code className="font-mono">{PROMPTS.refreshAll}</code>
              <CopyButton text={PROMPTS.refreshAll} />
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowConnect((s) => !s)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Connect Claude
          </button>
        </div>
      </header>

      {(showConnect || tickers.length === 0) && (
        <ConnectClaude onClose={tickers.length ? () => setShowConnect(false) : undefined} />
      )}

      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            aria-expanded={showList}
            className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm lg:hidden"
          >
            <span>
              Tickers <span className="text-text-subtle">({tickers.length})</span>
              {selected && <span className="ml-2 font-medium">{selected}</span>}
            </span>
            <span aria-hidden>{showList ? "▴" : "▾"}</span>
          </button>
          <div className={(showList || !selected ? "mt-3 block" : "hidden") + " lg:mt-0 lg:block"}>
            <TickerSidebar
              tickers={tickers}
              selected={selected}
              grouping={grouping}
              now={now}
              onGroupingChange={changeGrouping}
              onSelect={select}
              onAdd={addTicker}
              onRemove={removeTicker}
            />
          </div>
        </div>
        <div className="min-w-0">
          {!selected ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center text-sm text-text-muted">
              Add a ticker on the left to start.
            </div>
          ) : report.loading ? (
            <div className="py-12 text-center text-sm text-text-muted">Loading {selected}…</div>
          ) : report.error ? (
            <div className="py-12 text-center text-loss">Failed to load {selected}: {report.error}</div>
          ) : (
            <TickerReportView
              symbol={selected}
              ticker={selectedTicker}
              report={report.data?.report ?? null}
              strategies={report.data?.strategies ?? null}
              now={now}
            />
          )}
        </div>
      </div>
    </div>
  );
}
