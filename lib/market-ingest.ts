/**
 * Keeps market_bars and market_scans current.
 *
 * Each run fills the missing sessions oldest-first (at most `maxDays` provider
 * calls, so it stays under the free plan's 5 calls/minute without sleeping),
 * stores only the symbols we care about (the scan universe + every research
 * ticker), then recomputes the scan digest for each newly stored session.
 *
 * Triggered by the daily Vercel cron (app/api/market/ingest), by the
 * `refresh_market_data` MCP tool, and by scripts/backfill-market.mjs.
 * All I/O is injected, so the date logic is unit-tested without a network.
 */
import { computeScan } from "./market-scan";
import type { OhlcvBar } from "./technicals";
import type { MarketBar } from "./types";
import type { UniverseEntry } from "./universe";
import { EodRateLimitError, type GroupedDailyResult } from "./market-data/eod";

/** Calendar days of history loaded to compute one scan (~68 sessions). */
export const SCAN_LOOKBACK_DAYS = 100;
export const DEFAULT_MAX_DAYS_PER_RUN = 4;

export type IngestDeps = {
  fetchDay(date: string): Promise<GroupedDailyResult>;
  lastStoredDate(): Promise<string | null>;
  /** Sessions already stored in [from, to] (used by backfill mode). */
  storedDates(fromDate: string, toDate: string): Promise<Set<string>>;
  latestScanDate(): Promise<string | null>;
  keepSymbols(): Promise<Set<string>>;
  upsertBars(bars: MarketBar[]): Promise<void>;
  loadBars(fromDate: string, toDate: string): Promise<MarketBar[]>;
  saveScan(row: { scan_date: string; weighting: "cap" | "equal"; digest: unknown }): Promise<void>;
};

export type IngestResult = {
  planned: string[];
  ingested: { date: string; bars: number }[];
  empty: string[];
  scanned: string[];
  stoppedEarly: string | null;
};

/** YYYY-MM-DD for `now` in New York (the exchange's calendar day). */
export function exchangeDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Weekdays after `lastStored` up to and including `today`, oldest first,
 * truncated to `maxDays`. With nothing stored yet it starts `bootstrapDays`
 * weekdays back so a first cron run produces a usable (if short) history.
 * Holidays are not known in advance; the provider returns them empty.
 */
export function planIngestDates(
  lastStored: string | null,
  today: string,
  opts: { maxDays: number; bootstrapDays?: number }
): string[] {
  let start: string;
  if (lastStored) {
    start = addDays(lastStored, 1);
  } else {
    let d = today;
    let n = 0;
    const want = opts.bootstrapDays ?? opts.maxDays;
    while (n < want) {
      if (isWeekday(d)) n++;
      if (n < want) d = addDays(d, -1);
    }
    start = d;
  }
  const out: string[] = [];
  for (let d = start; d <= today && out.length < opts.maxDays; d = addDays(d, 1)) {
    if (isWeekday(d)) out.push(d);
  }
  return out;
}

/**
 * Backfill mode: weekdays in [fromDate, today] that are not stored yet, oldest
 * first, truncated to `maxDays`. The caller advances `fromDate` past the last
 * planned date between runs, so holidays (always empty) are not re-requested.
 */
export function planBackfillDates(
  fromDate: string,
  today: string,
  stored: Set<string>,
  maxDays: number
): string[] {
  const out: string[] = [];
  for (let d = fromDate; d <= today && out.length < maxDays; d = addDays(d, 1)) {
    if (isWeekday(d) && !stored.has(d)) out.push(d);
  }
  return out;
}

/** Group flat bars into per-symbol, oldest-first series. */
export function groupBars(bars: MarketBar[]): Record<string, OhlcvBar[]> {
  const out: Record<string, OhlcvBar[]> = {};
  for (const b of bars) (out[b.symbol] ??= []).push(b);
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function runIngest(
  deps: IngestDeps,
  universe: readonly UniverseEntry[],
  opts: {
    now: Date;
    maxDays?: number;
    bootstrapDays?: number;
    /** Backfill mode: fill unstored sessions from this date forward. */
    fromDate?: string;
    /** Recompute the latest stored session's scan even if one exists. */
    rescanLatest?: boolean;
  }
): Promise<IngestResult> {
  const today = exchangeDate(opts.now);
  const maxDays = opts.maxDays ?? DEFAULT_MAX_DAYS_PER_RUN;
  const lastStored = await deps.lastStoredDate();
  const planned = opts.fromDate
    ? planBackfillDates(opts.fromDate, today, await deps.storedDates(opts.fromDate, today), maxDays)
    : planIngestDates(lastStored, today, { maxDays, bootstrapDays: opts.bootstrapDays });
  const result: IngestResult = { planned, ingested: [], empty: [], scanned: [], stoppedEarly: null };

  const keep = planned.length ? await deps.keepSymbols() : new Set<string>();
  for (const date of planned) {
    let day: GroupedDailyResult;
    try {
      day = await deps.fetchDay(date);
    } catch (e) {
      if (e instanceof EodRateLimitError) {
        result.stoppedEarly = e.message;
        break;
      }
      throw e;
    }
    if (day.status === "empty") {
      result.empty.push(date);
      // Today not published yet: nothing after it can exist either.
      if (date === today) break;
      continue;
    }
    const bars = day.bars.filter((b) => keep.has(b.symbol));
    await deps.upsertBars(bars);
    result.ingested.push({ date, bars: bars.length });
  }

  // Scan every newly stored session; also (re)compute the latest stored
  // session's scan when it is missing or explicitly requested — e.g. after a
  // backfill filled history behind it, or the universe's share counts changed.
  const scanDates = result.ingested.map((d) => d.date);
  const latestStored = (await deps.lastStoredDate()) ?? lastStored;
  const latestScan = await deps.latestScanDate();
  if (
    latestStored &&
    !scanDates.includes(latestStored) &&
    (opts.rescanLatest || !latestScan || latestScan < latestStored)
  ) {
    scanDates.push(latestStored);
  }
  scanDates.sort();
  if (scanDates.length) {
    const from = addDays(scanDates[0], -SCAN_LOOKBACK_DAYS);
    const to = scanDates[scanDates.length - 1];
    const grouped = groupBars(await deps.loadBars(from, to));
    for (const date of scanDates) {
      const digest = computeScan(grouped, universe, date);
      if (digest.meta.covered === 0) continue;
      await deps.saveScan({ scan_date: date, weighting: digest.weighting, digest });
      result.scanned.push(date);
    }
  }
  return result;
}
