/**
 * Wires the pure ingest pipeline to Supabase and the EOD provider.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { eodApiKey, fetchGroupedDaily } from "@/lib/market-data/eod";
import { runIngest, type IngestResult } from "@/lib/market-ingest";
import { createMarketStore } from "@/lib/research-store";
import { UNIVERSE } from "@/lib/universe";

export class MarketDataNotConfiguredError extends Error {
  constructor() {
    super("MASSIVE_API_KEY is not set — market data cannot be refreshed");
    this.name = "MarketDataNotConfiguredError";
  }
}

export async function refreshMarketData(
  db: SupabaseClient,
  opts: {
    now?: Date;
    maxDays?: number;
    bootstrapDays?: number;
    fromDate?: string;
    rescanLatest?: boolean;
  } = {}
): Promise<IngestResult> {
  const apiKey = eodApiKey();
  if (!apiKey) throw new MarketDataNotConfiguredError();
  const store = createMarketStore(db);
  return runIngest(
    { ...store, fetchDay: (date) => fetchGroupedDaily(date, { apiKey }) },
    UNIVERSE,
    { ...opts, now: opts.now ?? new Date() }
  );
}
