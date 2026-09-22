import { NextRequest, NextResponse } from "next/server";
import { fetchSpot, isQuoteProviderConfigured } from "@/lib/quotes";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json(
        { error: "Missing symbol parameter" },
        { status: 400 }
      );
    }

    if (!isQuoteProviderConfigured()) {
      return NextResponse.json(
        { error: "No market data provider configured" },
        { status: 503 }
      );
    }

    const price = await fetchSpot(symbol);

    return NextResponse.json({ symbol: symbol.toUpperCase(), price });
  } catch (error) {
    console.error("Spot price fetch error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 }
    );
  }
}
