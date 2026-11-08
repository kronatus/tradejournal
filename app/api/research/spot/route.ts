/**
 * Live spot price for the Research header. Authenticated (unlike the older
 * sandbox spot route) because each call spends a Marketdata credit.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchSpot, isQuoteProviderConfigured } from "@/lib/quotes";
import { TickerSymbolSchema } from "@/lib/schemas";
import { adminClient, userFromRequest } from "@/lib/server/admin";

export async function GET(request: NextRequest) {
  try {
    const db = adminClient();
    if (!(await userFromRequest(db, request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const parsed = TickerSymbolSchema.safeParse(request.nextUrl.searchParams.get("symbol") ?? "");
    if (!parsed.success) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    if (!isQuoteProviderConfigured()) {
      return NextResponse.json({ error: "No market data provider configured" }, { status: 503 });
    }
    const price = await fetchSpot(parsed.data);
    return NextResponse.json({
      symbol: parsed.data,
      price_cents: Math.round(price * 100),
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[research/spot] failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
