import { describe, it, expect } from "vitest";
import {
  APP_TIME_ZONE,
  formatDate,
  formatShortDate,
  formatTime,
  formatDateTime,
  formatDayOrTime,
  appZoneTodayUtcMs,
  toDatetimeLocalValue,
} from "./utils";

// The suite runs with the container's zone (UTC), so anything below that comes
// out as Central proves the conversion rather than echoing the environment.

describe("app time zone", () => {
  it("is US Central", () => {
    expect(APP_TIME_ZONE).toBe("America/Chicago");
  });
});

describe("formatDate", () => {
  it("renders a UTC instant as the Central calendar date", () => {
    // 02:30 UTC on the 25th is still the 24th in Central.
    expect(formatDate("2026-09-25T02:30:00Z")).toBe("Sep 24, 2026");
  });

  it("does not shift a midday instant", () => {
    expect(formatDate("2026-09-24T18:00:00Z")).toBe("Sep 24, 2026");
  });

  it("renders missing and invalid values as an em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("formatShortDate", () => {
  it("drops the year and still converts the zone", () => {
    expect(formatShortDate("2026-09-25T02:30:00Z")).toBe("Sep 24");
  });
});

describe("formatTime", () => {
  it("uses a 24-hour clock", () => {
    // Midnight must read 00, not 12 AM and not 24.
    expect(formatTime("2026-09-24T05:00:00Z")).toBe("00:00 CDT");
    expect(formatTime("2026-09-24T05:30:00Z")).toBe("00:30 CDT");
    // Afternoon carries past 12 rather than restarting.
    expect(formatTime("2026-09-24T23:45:00Z")).toBe("18:45 CDT");
  });

  it("never emits AM or PM", () => {
    for (const h of [0, 6, 12, 18, 23]) {
      const iso = `2026-06-15T${String(h).padStart(2, "0")}:00:00Z`;
      expect(formatTime(iso)).not.toMatch(/[AP]M/);
      expect(formatDateTime(iso)).not.toMatch(/[AP]M/);
    }
  });

  it("converts the clock time and names the zone", () => {
    // 18:00 UTC is 1pm Central in September (CDT).
    expect(formatTime("2026-09-24T18:00:00Z")).toBe("13:00 CDT");
  });

  it("follows the zone into standard time", () => {
    // January is CST, six hours behind UTC.
    expect(formatTime("2026-01-15T18:00:00Z")).toBe("12:00 CST");
  });
});

describe("formatDateTime", () => {
  it("renders date and time together in Central", () => {
    expect(formatDateTime("2026-09-25T02:30:00Z")).toBe(
      "Sep 24, 2026, 21:30 CDT"
    );
  });
});

describe("formatDayOrTime", () => {
  it("shows the time for an instant earlier today", () => {
    const earlierToday = new Date();
    earlierToday.setUTCHours(earlierToday.getUTCHours() - 1);
    expect(formatDayOrTime(earlierToday)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("shows the date for an instant on another day", () => {
    // A fixed date well in the past, so the assertion does not depend on when
    // the suite runs.
    expect(formatDayOrTime("2024-03-11T18:00:00Z")).toBe("Mar 11");
  });

  it("renders nothing given nothing", () => {
    expect(formatDayOrTime(null)).toBe("—");
  });
});

describe("appZoneTodayUtcMs", () => {
  it("uses the Central calendar day, not the UTC one", () => {
    // Just past UTC midnight, Central is still on the previous date.
    expect(appZoneTodayUtcMs(new Date("2026-09-25T01:00:00Z"))).toBe(
      Date.UTC(2026, 8, 24)
    );
  });

  it("agrees with UTC during Central daytime", () => {
    expect(appZoneTodayUtcMs(new Date("2026-09-24T18:00:00Z"))).toBe(
      Date.UTC(2026, 8, 24)
    );
  });
});

describe("toDatetimeLocalValue", () => {
  // Deliberately the browser's zone: a datetime-local control carries none, so
  // whatever is prefilled is read back as the browser's local time.
  it("emits the shape the input expects", () => {
    expect(toDatetimeLocalValue(new Date(2026, 8, 24, 9, 5))).toBe(
      "2026-09-24T09:05"
    );
  });

  it("pads single digits", () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 2, 3, 4))).toBe(
      "2026-01-02T03:04"
    );
  });
});
