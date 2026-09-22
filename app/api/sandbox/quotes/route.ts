import { NextRequest, NextResponse } from "next/server";
import { fetchQuotes, isQuoteProviderConfigured } from "@/lib/quotes";

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

    if (!isQuoteProviderConfigured()) {
      return NextResponse.json(
        { error: "No market data provider configured" },
        { status: 503 }
      );
    }

    const { quotes, misses, creditsRemaining } = await fetchQuotes(symbols);

    // Keyed by the symbol the caller asked for, including the ones that came
    // back empty — reading this positionally would misalign legs.
    const perSymbol = symbols.map((occ) => {
      const quote = quotes.get(occ);
      if (!quote) {
        return { occ_symbol: occ, error: misses.get(occ) ?? "No quote returned" };
      }
      return {
        occ_symbol: occ,
        price_cents: Math.round(quote.price * 100),
        greeks: {
          delta: quote.delta,
          gamma: quote.gamma,
          theta: quote.theta,
          vega: quote.vega,
        },
        iv: quote.iv,
        as_of: quote.asOf,
        ...(quote.greeksMissing ? { greeks_missing: true } : {}),
      };
    });

    return NextResponse.json({ perSymbol, creditsRemaining });
  } catch (error) {
    console.error("Sandbox quotes fetch error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
