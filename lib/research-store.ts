/**
 * Data access for Research / Pulse, used by the MCP server, the ingest route
 * and the token route. Server-side only: these take the service-role client,
 * so every user-scoped query filters by `user_id` explicitly — RLS does not
 * apply to the service role. lib/research-store.test.ts enforces that.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketSweepInput, SaveStrategySetInput, TickerReportInput } from "./schemas";
import type {
  MarketBar,
  MarketScanRow,
  MarketSweep,
  ResearchTicker,
  StrategyIdea,
  StrategySet,
  StrategySetSummary,
  TickerReport,
} from "./types";
import { universeSymbols } from "./universe";

/** Supabase caps a response at 1000 rows by default. */
const PAGE = 1000;

type Row = Record<string, unknown>;
type Paged = { data: Row[] | null; error: { message: string } | null };

async function fetchAllPages(page: (from: number, to: number) => PromiseLike<Paged>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------------------------------------------------------------------------
// Per-user research data
// ---------------------------------------------------------------------------

export type TickerWithStatus = ResearchTicker & { latest_report_at: string | null };

export type OpenPosition = {
  strategy_id: string;
  underlying: string;
  strategy_kind: string;
  opened_at: string;
  legs: {
    occ_symbol: string;
    option_type: string;
    side: string;
    qty: number;
    strike_cents: number;
    expiry: string;
    entry_price_cents: number;
  }[];
};

export interface ResearchStore {
  listTickers(): Promise<TickerWithStatus[]>;
  addTicker(
    input: { symbol: string; sector?: string | null; industry?: string | null; notes?: string | null },
    addedBy: "user" | "claude"
  ): Promise<ResearchTicker>;
  removeTicker(symbol: string): Promise<boolean>;
  getLatestReport(symbol: string): Promise<TickerReport | null>;
  saveReport(input: TickerReportInput): Promise<{ id: string; created_at: string }>;
  listSweeps(limit: number): Promise<MarketSweep[]>;
  postSweep(input: MarketSweepInput): Promise<{ id: string; created_at: string }>;
  listOpenPositions(): Promise<OpenPosition[]>;
  getLatestStrategySet(symbol: string): Promise<StrategySet | null>;
  saveStrategySet(input: StrategySetRow): Promise<{ id: string; created_at: string }>;
}

/** What save_strategy_set stores: the request plus the server's own numbers. */
export type StrategySetRow = Pick<
  SaveStrategySetInput,
  "symbol" | "as_of" | "horizons" | "reference_price_cents" | "reference_at" | "account_value_cents"
> & {
  regime: Record<string, unknown>;
  ideas: StrategyIdea[];
  no_setup_reason: string | null;
  rejected_summary: StrategySetSummary;
  model_notes: string | null;
};

export function createResearchStore(db: SupabaseClient, userId: string): ResearchStore {
  return {
    async listTickers() {
      const tickers = check(
        await db
          .from("research_tickers")
          .select("*")
          .eq("user_id", userId)
          .order("sort_order", { ascending: true })
          .order("symbol", { ascending: true })
      ) as ResearchTicker[];
      if (!tickers.length) return [];
      const reports = check(
        await db
          .from("ticker_reports")
          .select("symbol, as_of")
          .eq("user_id", userId)
          .in(
            "symbol",
            tickers.map((t) => t.symbol)
          )
          .order("as_of", { ascending: false })
      ) as { symbol: string; as_of: string }[];
      const latest = new Map<string, string>();
      for (const r of reports) if (!latest.has(r.symbol)) latest.set(r.symbol, r.as_of);
      return tickers.map((t) => ({ ...t, latest_report_at: latest.get(t.symbol) ?? null }));
    },

    async addTicker(input, addedBy) {
      const existing = check(
        await db
          .from("research_tickers")
          .select("*")
          .eq("user_id", userId)
          .eq("symbol", input.symbol)
          .maybeSingle()
      ) as ResearchTicker | null;
      if (existing) {
        // Fill classification gaps without overwriting what is already there.
        const patch: Row = {};
        if (input.sector && !existing.sector) patch.sector = input.sector;
        if (input.industry && !existing.industry) patch.industry = input.industry;
        if (input.notes && !existing.notes) patch.notes = input.notes;
        if (!Object.keys(patch).length) return existing;
        patch.updated_at = new Date().toISOString();
        return check(
          await db
            .from("research_tickers")
            .update(patch)
            .eq("user_id", userId)
            .eq("id", existing.id)
            .select("*")
            .single()
        ) as ResearchTicker;
      }
      return check(
        await db
          .from("research_tickers")
          .insert({
            user_id: userId,
            symbol: input.symbol,
            sector: input.sector ?? null,
            industry: input.industry ?? null,
            notes: input.notes ?? null,
            added_by: addedBy,
          })
          .select("*")
          .single()
      ) as ResearchTicker;
    },

    async removeTicker(symbol) {
      const rows = check(
        await db
          .from("research_tickers")
          .delete()
          .eq("user_id", userId)
          .eq("symbol", symbol)
          .select("id")
      ) as { id: string }[];
      return rows.length > 0;
    },

    async getLatestReport(symbol) {
      return check(
        await db
          .from("ticker_reports")
          .select("*")
          .eq("user_id", userId)
          .eq("symbol", symbol)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ) as TickerReport | null;
    },

    async saveReport(input) {
      const saved = check(
        await db
          .from("ticker_reports")
          .insert({
            user_id: userId,
            symbol: input.symbol,
            as_of: input.as_of,
            snapshot: input.snapshot,
            technicals: input.technicals,
            fundamentals: input.fundamentals,
            articles: input.articles,
            next_earnings_date: input.next_earnings_date ?? null,
            model_notes: input.model_notes ?? null,
          })
          .select("id, created_at")
          .single()
      ) as { id: string; created_at: string };

      // Keep the sidebar's classification in step with the latest analysis.
      // Claude's sector/industry/setup win here: they come from fresh data.
      const ticker = await this.addTicker({ symbol: input.symbol }, "claude");
      const patch: Row = { updated_at: new Date().toISOString() };
      if (input.sector) patch.sector = input.sector;
      if (input.industry) patch.industry = input.industry;
      if (input.setup !== undefined) patch.setup = input.setup;
      check(
        await db
          .from("research_tickers")
          .update(patch)
          .eq("user_id", userId)
          .eq("id", ticker.id)
          .select("id")
      );
      return saved;
    },

    async listSweeps(limit) {
      return check(
        await db
          .from("market_sweeps")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit)
      ) as MarketSweep[];
    },

    async postSweep(input) {
      return check(
        await db
          .from("market_sweeps")
          .insert({
            user_id: userId,
            scan_date: input.scan_date ?? null,
            as_of: input.as_of,
            headline: input.headline,
            regime: input.regime,
            summary: input.summary,
            highlights: input.highlights,
            picks: input.picks,
            trends: input.trends,
            news: input.news,
          })
          .select("id, created_at")
          .single()
      ) as { id: string; created_at: string };
    },

    async getLatestStrategySet(symbol) {
      return check(
        await db
          .from("strategy_sets")
          .select("*")
          .eq("user_id", userId)
          .eq("symbol", symbol)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ) as StrategySet | null;
    },

    async saveStrategySet(input) {
      return check(
        await db
          .from("strategy_sets")
          .insert({
            user_id: userId,
            symbol: input.symbol,
            as_of: input.as_of,
            horizons: input.horizons,
            reference_price_cents: input.reference_price_cents,
            reference_at: input.reference_at,
            account_value_cents: input.account_value_cents,
            regime: input.regime,
            ideas: input.ideas,
            no_setup_reason: input.no_setup_reason,
            rejected_summary: input.rejected_summary,
            model_notes: input.model_notes,
          })
          .select("id, created_at")
          .single()
      ) as { id: string; created_at: string };
    },

    async listOpenPositions() {
      const rows = check(
        await db
          .from("strategies")
          .select(
            "id, underlying, strategy_kind, opened_at, legs(occ_symbol, option_type, side, qty, strike_cents, expiry, entry_price_cents, exit_price_cents)"
          )
          .eq("user_id", userId)
          .is("closed_at", null)
          .order("opened_at", { ascending: false })
      ) as {
        id: string;
        underlying: string;
        strategy_kind: string;
        opened_at: string;
        legs: (OpenPosition["legs"][number] & { exit_price_cents: number | null })[];
      }[];
      return rows
        .map((s) => ({
          strategy_id: s.id,
          underlying: s.underlying,
          strategy_kind: s.strategy_kind,
          opened_at: s.opened_at,
          legs: (s.legs ?? [])
            .filter((l) => l.exit_price_cents === null)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map(({ exit_price_cents, ...leg }) => leg),
        }))
        .filter((s) => s.legs.length > 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared market data
// ---------------------------------------------------------------------------

export interface MarketStore {
  lastStoredDate(): Promise<string | null>;
  storedDates(fromDate: string, toDate: string): Promise<Set<string>>;
  latestScanDate(): Promise<string | null>;
  keepSymbols(): Promise<Set<string>>;
  upsertBars(bars: MarketBar[]): Promise<void>;
  loadBars(fromDate: string, toDate: string, symbols?: string[]): Promise<MarketBar[]>;
  saveScan(row: { scan_date: string; weighting: "cap" | "equal"; digest: unknown }): Promise<void>;
  getScan(date?: string): Promise<MarketScanRow | null>;
  listScanDates(limit: number): Promise<string[]>;
}

export function createMarketStore(db: SupabaseClient): MarketStore {
  return {
    async lastStoredDate() {
      const row = check(
        await db.from("market_bars").select("date").order("date", { ascending: false }).limit(1).maybeSingle()
      ) as { date: string } | null;
      return row?.date ?? null;
    },

    async storedDates(fromDate, toDate) {
      // SPY trades every session, so its rows mark which sessions are stored.
      const rows = (await fetchAllPages((from, to) =>
        db
          .from("market_bars")
          .select("date")
          .eq("symbol", "SPY")
          .gte("date", fromDate)
          .lte("date", toDate)
          .order("date")
          .range(from, to)
      )) as { date: string }[];
      return new Set(rows.map((r) => r.date));
    },

    async latestScanDate() {
      const row = check(
        await db
          .from("market_scans")
          .select("scan_date")
          .order("scan_date", { ascending: false })
          .limit(1)
          .maybeSingle()
      ) as { scan_date: string } | null;
      return row?.scan_date ?? null;
    },

    async keepSymbols() {
      // Research tickers across all users: the scan universe plus anything
      // someone is researching gets price history for free.
      const rows = (await fetchAllPages((from, to) =>
        db.from("research_tickers").select("symbol").order("symbol").range(from, to)
      )) as { symbol: string }[];
      return new Set([...universeSymbols(), ...rows.map((r) => r.symbol)]);
    },

    async upsertBars(bars) {
      for (let i = 0; i < bars.length; i += PAGE) {
        check(
          await db
            .from("market_bars")
            .upsert(bars.slice(i, i + PAGE), { onConflict: "date,symbol" })
            .select("date")
            .limit(1)
        );
      }
    },

    async loadBars(fromDate, toDate, symbols) {
      return (await fetchAllPages((from, to) => {
        let q = db
          .from("market_bars")
          .select("date, symbol, open_cents, high_cents, low_cents, close_cents, vwap_cents, volume")
          .gte("date", fromDate)
          .lte("date", toDate);
        if (symbols) q = q.in("symbol", symbols);
        return q.order("date").order("symbol").range(from, to);
      })) as MarketBar[];
    },

    async saveScan(row) {
      check(
        await db
          .from("market_scans")
          .upsert({ ...row, computed_at: new Date().toISOString() }, { onConflict: "scan_date" })
          .select("scan_date")
      );
    },

    async getScan(date) {
      let q = db.from("market_scans").select("*");
      q = date ? q.eq("scan_date", date) : q.order("scan_date", { ascending: false }).limit(1);
      return check(await q.maybeSingle()) as MarketScanRow | null;
    },

    async listScanDates(limit) {
      const rows = check(
        await db.from("market_scans").select("scan_date").order("scan_date", { ascending: false }).limit(limit)
      ) as { scan_date: string }[];
      return rows.map((r) => r.scan_date);
    },
  };
}

// ---------------------------------------------------------------------------
// MCP tokens
// ---------------------------------------------------------------------------

/** sha256 hex of a token secret (Web Crypto: works in Node and edge runtimes). */
export async function hashToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new 256-bit secret, base64url. */
export function newTokenSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

/** Resolve a connector secret to its user, stamping last_used_at. */
export async function resolveMcpToken(db: SupabaseClient, secret: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) return null;
  const hash = await hashToken(secret);
  const row = check(
    await db
      .from("mcp_tokens")
      .select("id, user_id")
      .eq("token_hash", hash)
      .is("revoked_at", null)
      .maybeSingle()
  ) as { id: string; user_id: string } | null;
  if (!row) return null;
  await db.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return row.user_id;
}
