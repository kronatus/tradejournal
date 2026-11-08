/**
 * Daily market-data top-up, called by Vercel Cron (see vercel.json).
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations; any
 * other caller is rejected. Each run fills at most 4 missing sessions (free
 * provider tier: 5 calls/minute) and recomputes their scans.
 *
 * Backfill (scripts/backfill-market.mjs) uses the same endpoint:
 *   ?from=YYYY-MM-DD  fill unstored sessions from that date forward
 *   ?max_days=1..5    provider calls this run (default 4)
 *   ?rescan=1         recompute the latest session's scan afterwards
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/server/admin";
import { MarketDataNotConfiguredError, refreshMarketData } from "@/lib/server/market";

export const dynamic = "force-dynamic";

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
  max_days: z.coerce.number().int().min(1).max(5).optional(),
  rescan: z.enum(["0", "1"]).optional(),
});
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams;
  const parsed = Query.safeParse({
    from: q.get("from") ?? undefined,
    max_days: q.get("max_days") ?? undefined,
    rescan: q.get("rescan") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const result = await refreshMarketData(adminClient(), {
      bootstrapDays: 4,
      fromDate: parsed.data.from,
      maxDays: parsed.data.max_days,
      rescanLatest: parsed.data.rescan === "1",
    });
    console.log("[market/ingest]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof MarketDataNotConfiguredError ? 503 : 500;
    console.error("[market/ingest] failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
