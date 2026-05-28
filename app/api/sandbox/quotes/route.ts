import { NextRequest, NextResponse } from "next/server";
import { fetchTradierQuotes } from "@/lib/quotes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbols } = body as { symbols: string[] };

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid symbols array" },
        { status: 400 }
      );
    }

    const token = process.env.TRADIER_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Tradier API token not configured" },
        { status: 500 }
      );
    }

    const perSymbol = await fetchTradierQuotes(symbols, token);

    const result = Array.from(perSymbol.entries()).map(([occ, quote]) => ({
      occ_symbol: occ,
      price_cents: Math.round(quote.price * 100),
      greeks: {
        delta: quote.delta,
        gamma: quote.gamma,
        theta: quote.theta,
        vega: quote.vega,
      },
      iv: quote.iv,
    }));

    return NextResponse.json({
      perSymbol: result,
    });
  } catch (error) {
    console.error("Sandbox quotes fetch error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
