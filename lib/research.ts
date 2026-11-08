/**
 * Pure helpers for the Research and Pulse tabs.
 */
import { TickerSymbolSchema } from "./schemas";

/** Fields a ticker can be grouped by. Order of `levels` defines the hierarchy. */
export type GroupKey = "sector" | "industry" | "setup";

export const UNSORTED = "Unsorted";

export type Groupable = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  setup: string | null;
};

export type TickerGroup<T> = {
  key: GroupKey;
  label: string;
  /** Path of labels from the root, e.g. ["Information Technology", "Semiconductors"]. */
  path: string[];
  count: number;
  children: TickerGroup<T>[];
  /** Tickers at this level — only populated on leaf groups. */
  items: T[];
};

/** Named presets for the sidebar's group-by selector. */
export const GROUPINGS: Record<string, { label: string; levels: GroupKey[] }> = {
  sector_industry: { label: "Sector › Industry", levels: ["sector", "industry"] },
  sector: { label: "Sector", levels: ["sector"] },
  sector_setup: { label: "Sector › Setup", levels: ["sector", "setup"] },
  setup_sector: { label: "Setup › Sector", levels: ["setup", "sector"] },
};

export const DEFAULT_GROUPING = "sector_industry";

/**
 * Build a group tree from `levels` (e.g. sector › industry). A pivot is simply
 * a different `levels` order. Missing values collect under "Unsorted", which
 * always sorts last; everything else is alphabetical, and tickers within a leaf
 * keep their sort_order-then-symbol order from the caller.
 */
export function groupTickers<T extends Groupable>(
  tickers: T[],
  levels: GroupKey[],
  path: string[] = []
): TickerGroup<T>[] {
  if (!levels.length) return [];
  const [key, ...rest] = levels;
  const buckets = new Map<string, T[]>();
  for (const t of tickers) {
    const raw = t[key];
    const label = raw && raw.trim() ? raw.trim() : UNSORTED;
    buckets.set(label, [...(buckets.get(label) ?? []), t]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === UNSORTED) return 1;
      if (b === UNSORTED) return -1;
      return a.localeCompare(b);
    })
    .map(([label, items]) => {
      const p = [...path, label];
      const children = rest.length ? groupTickers(items, rest, p) : [];
      return {
        key,
        label,
        path: p,
        count: items.length,
        children,
        items: rest.length ? [] : items,
      };
    });
}

export type Freshness = "fresh" | "aging" | "stale" | "none";

/** Report age thresholds, in hours. */
export const FRESHNESS_HOURS = { fresh: 24, aging: 24 * 4 } as const;

export function reportFreshness(asOf: string | null | undefined, now: number): Freshness {
  if (!asOf) return "none";
  const t = Date.parse(asOf);
  if (Number.isNaN(t)) return "none";
  const hours = (now - t) / 3_600_000;
  if (hours <= FRESHNESS_HOURS.fresh) return "fresh";
  if (hours <= FRESHNESS_HOURS.aging) return "aging";
  return "stale";
}

/** Normalised ticker, or null when the input is not a plausible symbol. */
export function normalizeSymbol(input: string): string | null {
  const r = TickerSymbolSchema.safeParse(input);
  return r.success ? r.data : null;
}

/** Hours between an article and the report it belongs to (≥ 0). */
export function articleAgeHours(publishedAt: string, asOf: string): number | null {
  const p = Date.parse(publishedAt);
  const a = Date.parse(asOf);
  if (Number.isNaN(p) || Number.isNaN(a)) return null;
  return Math.max(0, (a - p) / 3_600_000);
}

/** Display tone for a technical rating — maps to the app's gain/loss tokens. */
export type Tone = "gain" | "loss" | "neutral" | "warn";

const TONES: Record<string, Tone> = {
  strong_up: "gain",
  up: "gain",
  sideways: "neutral",
  down: "loss",
  strong_down: "loss",
  strong: "gain",
  positive: "gain",
  neutral: "neutral",
  negative: "loss",
  weak: "loss",
  low: "gain",
  normal: "neutral",
  moderate: "neutral",
  elevated: "warn",
  high: "loss",
  very_high: "loss",
  bullish: "gain",
  bearish: "loss",
  watch: "warn",
  risk_on: "gain",
  risk_off: "loss",
  rotation: "warn",
  volatile: "warn",
};

export function ratingTone(rating: string | null | undefined): Tone {
  return (rating && TONES[rating]) || "neutral";
}

/** "strong_up" → "Strong up". */
export function formatRating(rating: string | null | undefined): string {
  if (!rating) return "—";
  const s = rating.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Signed percent with two decimals, or an em dash for null. */
export function formatPct(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

/** Large numbers as 1.2K / 3.4M / 5.6B / 7.8T. */
export function formatCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [n, u] of units) {
    if (abs >= n) return `${(v / n).toFixed(abs / n >= 100 ? 0 : 1)}${u}`;
  }
  return String(Math.round(v));
}

/** Prompt text the UI offers for copying into Claude chat. */
export const PROMPTS = {
  research: (symbol: string) => `Run ticker research on ${symbol}`,
  refreshAll: "Refresh my research list",
  sweep: "Run a market sweep",
} as const;
