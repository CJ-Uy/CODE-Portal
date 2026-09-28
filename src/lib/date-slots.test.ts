import { describe, expect, it } from "vitest";
import {
	buildMonthGrid,
	deriveEnd,
	endOfUtc8Day,
	formatEventRange,
	fromLocalInput,
	startOfUtc8Day,
	timeSlots,
	toLocalDate,
	toLocalInput,
} from "./date-slots";

describe("buildMonthGrid", () => {
	it("always returns six full weeks so the grid never jumps height", () => {
		expect(buildMonthGrid(2026, 6)).toHaveLength(42);
	});

	it("pads leading and trailing days from the neighbouring months", () => {
		// July 2026 starts on a Wednesday.
		const grid = buildMonthGrid(2026, 6);
		expect(grid[0]).toEqual({ date: "2026-06-29", day: 29, inMonth: false });
		expect(grid[2]).toEqual({ date: "2026-07-01", day: 1, inMonth: true });
		expect(grid.filter((slot) => slot.inMonth)).toHaveLength(31);
	});

	it("handles a leap February", () => {
		const grid = buildMonthGrid(2028, 1);
		expect(grid.filter((slot) => slot.inMonth)).toHaveLength(29);
	});
});

describe("timeSlots", () => {
	it("covers the whole day at the requested step", () => {
		const slots = timeSlots(30);
		expect(slots).toHaveLength(48);
		expect(slots[0]).toBe("00:00");
		expect(slots[26]).toBe("13:00");
		expect(slots[47]).toBe("23:30");
	});
});

describe("deriveEnd", () => {
	it("adds the duration", () => {
		expect(deriveEnd("2026-07-25T13:00", 60)).toBe("2026-07-25T14:00");
	});

	it("rolls over midnight into the next day", () => {
		expect(deriveEnd("2026-07-25T23:30", 60)).toBe("2026-07-26T00:30");
	});

	it("rolls over a month boundary", () => {
		expect(deriveEnd("2026-07-31T23:00", 120)).toBe("2026-08-01T01:00");
	});

	it("returns an empty string for an empty start", () => {
		expect(deriveEnd("", 60)).toBe("");
	});
});

describe("all-day boundaries", () => {
	it("snaps to the first and last instant of the UTC+8 day", () => {
		const middle = fromLocalInput("2026-08-12T14:30");
		expect(toLocalDate(startOfUtc8Day(middle))).toBe("2026-08-12");
		expect(toLocalDate(endOfUtc8Day(middle))).toBe("2026-08-12");
		// The last instant, not the next midnight: midnight belongs to the following day and would
		// render multi-day bars one day too long.
		expect(endOfUtc8Day(middle).getTime() - startOfUtc8Day(middle).getTime()).toBe(24 * 60 * 60 * 1000 - 1);
	});

	it("keeps a same-day all-day event ordered so validation accepts it", () => {
		const day = fromLocalInput("2026-08-12T09:00");
		expect(endOfUtc8Day(day).getTime()).toBeGreaterThan(startOfUtc8Day(day).getTime());
	});
});

describe("formatEventRange", () => {
	it("shows a time range for a timed single-day event", () => {
		const text = formatEventRange(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-12T17:00"), false);
		expect(text).toContain("Aug 12");
		expect(text).not.toContain("All day");
	});

	it("shows both dates for a timed multi-day event", () => {
		const text = formatEventRange(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-14T17:00"), false);
		expect(text).toContain("Aug 12");
		expect(text).toContain("Aug 14");
	});

	it("labels a single all-day event without a range", () => {
		const day = fromLocalInput("2026-08-12T00:00");
		expect(formatEventRange(startOfUtc8Day(day), endOfUtc8Day(day), true)).toBe("Aug 12, 2026 · All day");
	});

	it("labels a multi-day all-day event with both ends", () => {
		const text = formatEventRange(
			startOfUtc8Day(fromLocalInput("2026-08-12T00:00")),
			endOfUtc8Day(fromLocalInput("2026-08-14T00:00")),
			true,
		);
		expect(text).toContain("Aug 12");
		expect(text).toContain("Aug 14");
		expect(text).toContain("All day");
	});

	it("shows a timed event's literal end instant, midnight included", () => {
		// Deliberately NOT clamped to the inclusive last day: the event really does end at that
		// moment, and "ends Aug 14" would leave the reader guessing at what time. The inclusive-day
		// rule governs how long the calendar BAR is drawn (see inclusiveEndDate), not this text.
		const text = formatEventRange(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-15T00:00"), false);
		expect(text).toContain("Aug 12");
		expect(text).toContain("Aug 15");
	});
});

describe("toLocalInput", () => {
	it("formats local wall-clock time, not UTC", () => {
		const date = new Date(2026, 6, 25, 13, 5);
		expect(toLocalInput(date)).toBe("2026-07-25T13:05");
	});

	it("round-trips a browser datetime-local value without changing the instant", () => {
		const value = "2026-07-25T13:05";
		expect(toLocalInput(fromLocalInput(value))).toBe(value);
	});
});
