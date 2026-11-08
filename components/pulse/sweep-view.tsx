"use client";

import Link from "next/link";
import { formatDateTime } from "@/lib/utils";
import { formatRating, ratingTone } from "@/lib/research";
import { HIGHLIGHT_KINDS, type SweepPick } from "@/lib/schemas";
import type { MarketSweep } from "@/lib/types";
import { Card, ToneBadge } from "@/components/research/ui";
import { NewsCard } from "./news-card";

const KIND_LABEL: Record<(typeof HIGHLIGHT_KINDS)[number], string> = {
  abnormality: "Abnormalities",
  sector: "Sectors",
  trend: "Trends",
  breadth: "Breadth",
  macro: "Macro",
};

export function SweepView({
  sweep,
  researchSymbols,
  onAdd,
}: {
  sweep: MarketSweep;
  researchSymbols: Set<string>;
  onAdd: (pick: SweepPick) => Promise<void>;
}) {
  const byKind = HIGHLIGHT_KINDS.map((k) => ({
    kind: k,
    items: sweep.highlights.filter((h) => h.kind === k),
  })).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{sweep.headline}</h2>
              {sweep.regime && <ToneBadge tone={ratingTone(sweep.regime)}>{formatRating(sweep.regime)}</ToneBadge>}
            </div>
            <p className="mt-1 text-xs text-text-subtle">
              Claude&apos;s read · {formatDateTime(sweep.as_of)}
              {sweep.scan_date && ` · based on the ${sweep.scan_date} scan`}
            </p>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{sweep.summary}</p>
      </Card>

      <NewsCard news={sweep.news ?? []} asOf={sweep.as_of} />

      {byKind.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {byKind.map((g) => (
            <Card key={g.kind} title={KIND_LABEL[g.kind]}>
              <ul className="space-y-3">
                {g.items.map((h, i) => (
                  <li key={i}>
                    <div className="text-sm font-medium">{h.title}</div>
                    <p className="text-sm text-text-muted">{h.body}</p>
                    {h.symbols.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {h.symbols.map((s) => (
                          <Link key={s} href={`/research?symbol=${s}`} className="text-accent hover:underline">
                            {s}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {sweep.picks.length > 0 && (
        <Card title="Picks to dig into">
          <ul className="divide-y divide-border">
            {sweep.picks.map((p) => (
              <PickRow key={p.symbol} pick={p} added={researchSymbols.has(p.symbol)} onAdd={onAdd} />
            ))}
          </ul>
        </Card>
      )}

      {sweep.trends.length > 0 && (
        <Card title="Trends">
          <ul className="space-y-3">
            {sweep.trends.map((t, i) => (
              <li key={i}>
                <div className="text-sm font-medium">{t.title}</div>
                <p className="text-sm text-text-muted">{t.body}</p>
                {t.sectors.length > 0 && <div className="mt-1 text-xs text-text-subtle">{t.sectors.join(" · ")}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PickRow({
  pick,
  added,
  onAdd,
}: {
  pick: SweepPick;
  added: boolean;
  onAdd: (pick: SweepPick) => Promise<void>;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/research?symbol=${pick.symbol}`} className="font-semibold hover:text-accent hover:underline">
            {pick.symbol}
          </Link>
          <ToneBadge tone={ratingTone(pick.direction)}>{formatRating(pick.direction)}</ToneBadge>
          <span className="text-xs text-text-subtle">
            {pick.horizon} · {pick.signal}
            {pick.sector ? ` · ${pick.sector}` : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-muted">{pick.thesis}</p>
      </div>
      {added ? (
        <span className="text-xs text-text-subtle">On research list</span>
      ) : (
        <button
          type="button"
          onClick={() => void onAdd(pick)}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Add to Research
        </button>
      )}
    </li>
  );
}
