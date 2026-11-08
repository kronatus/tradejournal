"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { formatCents, formatDate, formatDateTime, formatShortDate } from "@/lib/utils";
import {
  articleAgeHours,
  formatCompact,
  formatPct,
  formatRating,
  PROMPTS,
  ratingTone,
  reportFreshness,
} from "@/lib/research";
import type { ResearchTicker, TickerReport } from "@/lib/types";
import type { Technicals } from "@/lib/schemas";
import { Card, PromptHandoff, signClass, Stat, ToneBadge } from "./ui";

type Spot = { price_cents: number; fetched_at: string } | { error: string } | null;

/** Live spot from the quote provider (~1 Marketdata credit per load). */
function useLiveSpot(symbol: string): Spot {
  const { session } = useAuth();
  const token = session?.access_token;
  const [state, setState] = useState<{ symbol: string; spot: Spot } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/research/spot?symbol=${encodeURIComponent(symbol)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        setState({
          symbol,
          spot: res.ok ? body : { error: body.error ?? `HTTP ${res.status}` },
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ symbol, spot: { error: (e as Error).message } });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, token]);

  return state?.symbol === symbol ? state.spot : null;
}

export function TickerReportView({
  symbol,
  ticker,
  report,
  now,
}: {
  symbol: string;
  ticker: ResearchTicker | null;
  report: TickerReport | null;
  now: number;
}) {
  const freshness = reportFreshness(report?.as_of, now);

  return (
    <div className="space-y-5">
      <TickerHeader symbol={symbol} ticker={ticker} report={report} />

      {!report ? (
        <Card>
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-text-muted">No analysis for {symbol} yet.</p>
            <div className="flex justify-center">
              <PromptHandoff prompt={PROMPTS.research(symbol)} hint="Ask Claude:" />
            </div>
          </div>
        </Card>
      ) : (
        <>
          {freshness === "stale" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn-soft px-4 py-2 text-sm text-warn">
              <span>This analysis is from {formatDate(report.as_of)} and may be out of date.</span>
              <PromptHandoff prompt={PROMPTS.research(symbol)} />
            </div>
          )}
          <KeyNumbers report={report} />
          {report.technicals && <TechnicalsGrid technicals={report.technicals} />}
          {report.fundamentals && (
            <Card title="Fundamentals">
              <p className="text-sm leading-relaxed">{report.fundamentals}</p>
            </Card>
          )}
          <Card title="Options strategies">
            <p className="text-sm text-text-muted">
              Strategy ideas will appear here once the strategy framework is defined.
            </p>
          </Card>
          <ArticlesList report={report} />
          {report.model_notes && (
            <p className="text-xs text-text-subtle">Analyst notes: {report.model_notes}</p>
          )}
        </>
      )}
    </div>
  );
}

function TickerHeader({
  symbol,
  ticker,
  report,
}: {
  symbol: string;
  ticker: ResearchTicker | null;
  report: TickerReport | null;
}) {
  const spot = useLiveSpot(symbol);
  const snap = report?.snapshot;
  const sector = ticker?.sector;
  const industry = ticker?.industry;

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{symbol}</h1>
          {ticker?.setup && <ToneBadge tone="neutral">{ticker.setup}</ToneBadge>}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {[sector, industry].filter(Boolean).join(" › ") || "Unclassified"}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-6 text-right">
        {snap && (
          <div>
            <div className="text-xs text-text-muted">At analysis</div>
            <div className="tabular text-2xl font-semibold">{formatCents(snap.price_cents)}</div>
            <div className="tabular text-xs">
              <span className={signClass(snap.change_pct)}>{formatPct(snap.change_pct)}</span>
              <span className="text-text-subtle"> · {formatDateTime(snap.price_as_of ?? report!.as_of)}</span>
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-text-muted">Live spot</div>
          {spot === null ? (
            <div className="tabular text-2xl font-semibold text-text-subtle">…</div>
          ) : "error" in spot ? (
            <div className="max-w-[14rem] text-xs text-text-subtle" title={spot.error}>
              Unavailable
            </div>
          ) : (
            <>
              <div className="tabular text-2xl font-semibold">{formatCents(spot.price_cents)}</div>
              {snap?.price_cents ? (
                <div className={"tabular text-xs " + signClass(spot.price_cents - snap.price_cents)}>
                  {formatPct(((spot.price_cents - snap.price_cents) / snap.price_cents) * 100)} since analysis
                </div>
              ) : (
                <div className="text-xs text-text-subtle">{formatDateTime(spot.fetched_at)}</div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function RangeBar({ low, high, value }: { low: number; high: number; value: number }) {
  const pct = high > low ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : 50;
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 rounded-full bg-muted">
        <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-accent" style={{ left: `${pct}%` }} />
      </div>
      <div className="tabular mt-1 flex justify-between text-[11px] text-text-subtle">
        <span>{formatCents(low)}</span>
        <span>{formatCents(high)}</span>
      </div>
    </div>
  );
}

function KeyNumbers({ report }: { report: TickerReport }) {
  const s = report.snapshot;
  const a = s.analyst;
  const relVol = s.volume && s.avg_volume_30d ? s.volume / s.avg_volume_30d : null;
  const upside =
    a?.target_mean_cents && s.price_cents ? ((a.target_mean_cents - s.price_cents) / s.price_cents) * 100 : null;

  return (
    <Card title="Key numbers" action={<span className="text-xs text-text-subtle">as of {formatDateTime(report.as_of)}</span>}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Market cap" value={s.market_cap_cents != null ? `$${formatCompact(s.market_cap_cents / 100)}` : "—"} />
        <Stat label="P/E" value={s.pe_ratio?.toFixed(1) ?? "—"} sub={s.pb_ratio != null ? `P/B ${s.pb_ratio.toFixed(1)}` : undefined} />
        <Stat
          label="Volume"
          value={formatCompact(s.volume)}
          sub={relVol !== null ? `${relVol.toFixed(2)}× 30-day avg` : undefined}
          valueClass={relVol !== null && relVol >= 2 ? "text-warn" : ""}
        />
        <Stat label="Day range" value={`${formatCents(s.day_low_cents)} – ${formatCents(s.day_high_cents)}`} sub={s.prev_close_cents != null ? `Prev close ${formatCents(s.prev_close_cents)}` : undefined} />
        <Stat label="Dividend yield" value={s.dividend_yield_pct != null ? `${s.dividend_yield_pct.toFixed(2)}%` : "—"} />
        <Stat label="Beta" value={s.beta?.toFixed(2) ?? "—"} />
        <Stat
          label="Implied vol"
          value={s.iv != null ? `${(s.iv * 100).toFixed(1)}%` : "—"}
          sub={s.iv_rank != null ? `IV rank ${Math.round(s.iv_rank)}` : undefined}
        />
        <Stat
          label="Next earnings"
          value={report.next_earnings_date ? formatShortDate(`${report.next_earnings_date}T12:00:00Z`) : "—"}
        />
        {a && (
          <Stat
            label="Analysts"
            value={
              <span>
                <span className="text-gain">{a.buy}</span> / <span>{a.hold}</span> / <span className="text-loss">{a.sell}</span>
              </span>
            }
            sub={a.target_mean_cents != null ? `Target ${formatCents(a.target_mean_cents)} (${formatPct(upside, 1)})` : "No price target"}
          />
        )}
        {s.week52_low_cents != null && s.week52_high_cents != null && s.price_cents != null && (
          <div className="col-span-2 min-w-0">
            <div className="text-xs text-text-muted">52-week range</div>
            <RangeBar low={s.week52_low_cents} high={s.week52_high_cents} value={s.price_cents} />
          </div>
        )}
      </div>
    </Card>
  );
}

const DIMENSIONS: { key: keyof Technicals; label: string }[] = [
  { key: "trend", label: "Trend" },
  { key: "momentum", label: "Momentum" },
  { key: "volatility", label: "Volatility" },
  { key: "risk", label: "Risk" },
];

function formatMetric(name: string, v: number | null): string {
  if (v === null) return "—";
  if (name.endsWith("_cents") || /^(sma|ema)\d+$/.test(name)) return formatCents(v);
  if (name.endsWith("_pct")) return formatPct(v);
  return Math.abs(v) >= 1000 ? formatCompact(v) : String(Math.round(v * 100) / 100);
}

function TechnicalsGrid({ technicals }: { technicals: Technicals }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {DIMENSIONS.map(({ key, label }) => {
        const d = technicals[key];
        const metrics = Object.entries(d.metrics ?? {});
        return (
          <Card key={key} title={label} action={<ToneBadge tone={ratingTone(d.rating)}>{formatRating(d.rating)}</ToneBadge>}>
            <p className="text-sm leading-relaxed">{d.summary}</p>
            {metrics.length > 0 && (
              <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                {metrics.map(([name, v]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <dt className="text-text-muted">{name.replace(/_cents$/, "").replace(/_/g, " ")}</dt>
                    <dd className="tabular">{formatMetric(name, v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ArticlesList({ report }: { report: TickerReport }) {
  const articles = report.articles ?? [];
  return (
    <Card title="Latest news">
      {articles.length === 0 ? (
        <p className="text-sm text-text-muted">No relevant articles from the last two days.</p>
      ) : (
        <ul className="divide-y divide-border">
          {articles.map((a) => {
            const age = articleAgeHours(a.published_at, report.as_of);
            const old = age !== null && age > 48;
            return (
              <li key={a.url} className={"py-3 first:pt-0 last:pb-0 " + (old ? "opacity-60" : "")}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:text-accent hover:underline"
                >
                  {a.title}
                </a>
                <div className="mt-0.5 text-xs text-text-subtle">
                  {a.source} · {hostOf(a.url)} · {formatDateTime(a.published_at)}
                  {old && " · older than 48h"}
                </div>
                {a.summary && <p className="mt-1 text-sm text-text-muted">{a.summary}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
