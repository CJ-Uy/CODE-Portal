import { describe, expect, it } from "vitest";
import { inclusiveEndDate, monthRange, toIsoDate } from "./calendar";
import { fromLocalInput } from "./date-slots";

describe("inclusiveEndDate", () => {
	it("returns the start day for an event with no end", () => {
		expect(inclusiveEndDate(fromLocalInput("2026-08-12T09:00"), null)).toBe("2026-08-12");
	});

	it("returns the start day for a same-day event", () => {
		expect(inclusiveEndDate(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-12T17:00"))).toBe("2026-08-12");
	});

	it("spans to the last day a multi-day event occupies", () => {
		expect(inclusiveEndDate(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-14T17:00"))).toBe("2026-08-14");
	});

	it("does NOT count a midnight end as an extra day", () => {
		// Ends the instant Aug 15 begins, so it occupies none of Aug 15. Without the 1ms step back
		// this returns 2026-08-15 and every such bar renders one day too long.
		expect(inclusiveEndDate(fromLocalInput("2026-08-12T09:00"), fromLocalInput("2026-08-15T00:00"))).toBe("2026-08-14");
	});

	it("never returns a day before the start, even for a zero-length event at midnight", () => {
		const midnight = fromLocalInput("2026-08-12T00:00");
		expect(inclusiveEndDate(midnight, midnight)).toBe("2026-08-12");
	});

	it("covers a whole all-day span stored to the last millisecond", () => {
		const start = fromLocalInput("2026-08-12T00:00");
		const end = new Date(fromLocalInput("2026-08-14T00:00").getTime() + 24 * 60 * 60 * 1000 - 1);
		expect(inclusiveEndDate(start, end)).toBe("2026-08-14");
	});
});

describe("monthRange", () => {
	it("returns a half-open UTC+8 month window", () => {
		const { start, end } = monthRange(2026, 6);
		expect(start.toISOString()).toBe("2026-05-31T16:00:00.000Z");
		expect(end.toISOString()).toBe("2026-06-30T16:00:00.000Z");
	});

	it("rolls over the year at December", () => {
		const { start, end } = monthRange(2026, 12);
		expect(start.toISOString()).toBe("2026-11-30T16:00:00.000Z");
		expect(end.toISOString()).toBe("2026-12-31T16:00:00.000Z");
	});
});

describe("toIsoDate", () => {
	it("formats a date as a UTC+8 calendar day", () => {
		expect(toIsoDate(new Date("2026-06-19T23:59:00.000Z"))).toBe("2026-06-20");
	});
});
