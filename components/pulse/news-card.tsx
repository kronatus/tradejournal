"use client";

import Link from "next/link";
import type { SweepNews } from "@/lib/schemas";
import { formatTime, formatShortDate } from "@/lib/utils";
import { Card, ToneBadge } from "@/components/research/ui";

const IMPACT: Record<SweepNews["impact"], { label: string; tone: "warn" | "neutral" }> = {
  market: { label: "Market", tone: "warn" },
  sector: { label: "Sector", tone: "neutral" },
  stock: { label: "Stock", tone: "neutral" },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "3h ago" relative to the sweep, falling back to a Central date/time. */
function age(publishedAt: string, asOf: string): string {
  const hours = (Date.parse(asOf) - Date.parse(publishedAt)) / 3_600_000;
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return "under 1h before sweep";
  if (hours < 24) return `${Math.round(hours)}h before sweep`;
  return `${formatShortDate(publishedAt)} ${formatTime(publishedAt)}`;
}

/** Market headlines of the day from Claude's sweep (migration 0008). */
export function NewsCard({ news, asOf }: { news: SweepNews[]; asOf: string }) {
  if (!news.length) return null;
  return (
    <Card title="News of the day" action={<span className="text-xs text-text-subtle">by market impact</span>}>
      <ol className="divide-y divide-border">
        {news.map((n) => (
          <li key={n.url} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 text-sm font-medium hover:text-accent hover:underline"
              >
                {n.title}
              </a>
              <ToneBadge tone={IMPACT[n.impact].tone}>{IMPACT[n.impact].label}</ToneBadge>
            </div>
            <div className="mt-0.5 text-xs text-text-subtle">
              {n.source} · {hostOf(n.url)} · {age(n.published_at, asOf)}
            </div>
            {n.summary && <p className="mt-1 text-sm text-text-muted">{n.summary}</p>}
            {(n.symbols.length > 0 || n.sectors.length > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                {n.symbols.map((s) => (
                  <Link
                    key={s}
                    href={`/research?symbol=${encodeURIComponent(s)}`}
                    className="rounded border border-border px-1.5 py-0.5 font-medium text-text-muted hover:border-accent hover:text-accent"
                  >
                    {s}
                  </Link>
                ))}
                {n.sectors.map((s) => (
                  <span key={s} className="text-text-subtle">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
