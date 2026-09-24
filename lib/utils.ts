/**
 * Money for display. Accepts null/undefined and non-finite values and renders
 * an em dash: a column whose database value is missing should read as unknown,
 * never as "$NaN". Callers wanting a hard failure should check before calling.
 */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function formatKind(kind: string): string {
  return kind
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatOccSymbol(occSymbol: string): string {
  // Format: O:TICKERYYMMDD[C|P]STRIKEPRICE (8-digit strike in cents)
  const match = occSymbol.match(/O:([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})/);
  if (!match) return occSymbol;

  const [, ticker, yy, mm, dd, type, strikeStr] = match;
  const strikeCents = parseInt(strikeStr, 10);
  const strike = (strikeCents / 100).toFixed(2);

  // Convert YY to full year (assume 20xx for 00-99)
  const year = 2000 + parseInt(yy, 10);
  const expiry = `${mm}/${dd}/${year}`;
  const typeLabel = type === "C" ? "Call" : "Put";

  return `${ticker} ${expiry} $${strike} ${typeLabel}`;
}

export function formatSide(side: string): string {
  return side === "long" ? "Buy" : "Sell";
}
