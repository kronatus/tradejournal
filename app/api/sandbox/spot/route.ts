import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json(
        { error: "Missing symbol parameter" },
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

    const response = await fetch(
      `https://api.tradier.com/v1/markets/quotes?symbols=${symbol}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Tradier" },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      quotes?: { quote?: { symbol: string; last?: number; bid?: number; ask?: number }[] };
    };

    const quote = data.quotes?.quote?.[0];
    if (!quote) {
      return NextResponse.json(
        { error: "Quote not found" },
        { status: 404 }
      );
    }

    const lastPrice = quote.last ?? (quote.bid && quote.ask ? (quote.bid + quote.ask) / 2 : null);

    if (lastPrice === null || lastPrice === undefined) {
      return NextResponse.json(
        { error: "Unable to determine price" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      symbol: quote.symbol,
      price: lastPrice,
    });
  } catch (error) {
    console.error("Spot price fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
