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

// --- Dates and times ------------------------------------------------------
//
// Everything on screen is rendered in US Central. It is pinned explicitly
// rather than left to the viewer's locale for two reasons: the journal records
// US market activity, which is what the trader thinks in; and server components
// render in the container's zone (UTC) while the browser would render in its
// own, so an unpinned timestamp produces a hydration mismatch.
//
// "America/Chicago" rather than a fixed offset, so CST and CDT are handled by
// the zone database instead of by hand.
//
// Clocks are 24-hour. hourCycle "h23" rather than hour12:false, because the
// latter renders midnight as 24:00 on some engines; h23 pins the range to
// 00-23.

export const APP_TIME_ZONE = "America/Chicago";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar parts of an instant as they read in the app's zone. */
function zonedParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** "Sep 24, 2026" */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Sep 24" — for columns where the year is implied. */
export function formatShortDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

/** "15:22 CDT" */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}

/** "Sep 24, 2026, 15:22 CDT" */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}

/**
 * Time for today's timestamps, date for older ones — "today" meaning the
 * current date in the app's zone, not the viewer's.
 */
export function formatDayOrTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  const then = zonedParts(d);
  const now = zonedParts(new Date());
  const sameDay =
    then.year === now.year && then.month === now.month && then.day === now.day;
  return sameDay
    ? d.toLocaleTimeString("en-US", {
        timeZone: APP_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : formatShortDate(d);
}

/** Today's calendar date in the app's zone, as a UTC-midnight timestamp. */
export function appZoneTodayUtcMs(now: Date = new Date()): number {
  const { year, month, day } = zonedParts(now);
  return Date.UTC(year, month - 1, day);
}

/**
 * "YYYY-MM-DDTHH:MM" for a datetime-local input, in the BROWSER's zone.
 *
 * Deliberately not the app zone: the control carries no zone, and the browser
 * reads whatever is typed as its own local time. Prefilling anything else
 * would be silently reinterpreted on submit.
 */
export function toDatetimeLocalValue(value: DateInput = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
