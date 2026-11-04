import { describe, expect, it } from "vitest";
import { addDays, hourRange, layoutTimedEvents, minutesIntoDay, parseIsoDay, timedSpan, weekDays } from "./calendar-time-grid";

describe("calendar day math", () => {
	it("steps across month and year boundaries", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
		expect(addDays("2026-11-04", 7)).toBe("2026-11-11");
	});

	it("accepts only real days", () => {
		expect(parseIsoDay("2026-11-04")).toBe("2026-11-04");
		expect(parseIsoDay("2028-02-29")).toBe("2028-02-29");
		expect(parseIsoDay("2026-02-30")).toBeNull();
		expect(parseIsoDay("2026-11-4")).toBeNull();
		expect(parseIsoDay("nonsense")).toBeNull();
		expect(parseIsoDay(undefined)).toBeNull();
	});

	it("builds the Sunday-first week, crossing a month", () => {
		// Wed Nov 4 2026 sits in the week of Sun Nov 1.
		expect(weekDays("2026-11-04")).toEqual([
			"2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07",
		]);
		// A Sunday is its own week start; Sat Oct 31 belongs to the week of Oct 25.
		expect(weekDays("2026-11-01")[0]).toBe("2026-11-01");
		expect(weekDays("2026-10-31")).toEqual([
			"2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31",
		]);
	});

	it("measures minutes from Manila midnight, not UTC midnight", () => {
		// 01:30Z is 9:30 AM in Manila.
		expect(minutesIntoDay("2026-11-04T01:30:00.000Z", "2026-11-04")).toBe(570);
		// 16:00Z on Nov 3 is midnight Nov 4 in Manila.
		expect(minutesIntoDay("2026-11-03T16:00:00.000Z", "2026-11-04")).toBe(0);
	});
});

describe("timed event spans", () => {
	const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00+08:00`).toISOString();

	it("places a timed event by its Manila start and end", () => {
		expect(timedSpan({ id: "a", date: "2026-11-04", startsAt: at("09:00"), endsAt: at("10:30") })).toEqual({ id: "a", start: 540, end: 630 });
	});

	it("draws an hour for an open end and stretches tiny events", () => {
		expect(timedSpan({ id: "a", date: "2026-11-04", startsAt: at("09:00"), endsAt: null })).toMatchObject({ start: 540, end: 600 });
		expect(timedSpan({ id: "a", date: "2026-11-04", startsAt: at("09:00"), endsAt: at("09:10") })).toMatchObject({ start: 540, end: 570 });
	});

	it("ends at the bottom of the day for an end at the next midnight, keeping late blocks inside it", () => {
		const nextMidnight = new Date("2026-11-05T00:00:00+08:00").toISOString();
		expect(timedSpan({ id: "a", date: "2026-11-04", startsAt: at("22:00"), endsAt: nextMidnight })).toMatchObject({ start: 1320, end: 1440 });
		expect(timedSpan({ id: "a", date: "2026-11-04", startsAt: at("23:50"), endsAt: null })).toMatchObject({ start: 1410, end: 1440 });
	});

	it("widens the default hour range to whole hours around outliers", () => {
		expect(hourRange([])).toEqual({ startHour: 7, endHour: 22 });
		expect(hourRange([{ id: "a", start: 330, end: 400 }, { id: "b", start: 1300, end: 1390 }])).toEqual({ startHour: 5, endHour: 24 });
	});
});

describe("timed event columns", () => {
	const span = (id: string, start: number, end: number) => ({ id, start, end });
	const columnsOf = (spans: ReturnType<typeof span>[]) =>
		Object.fromEntries(layoutTimedEvents(spans).map((p) => [p.item.id, [p.column, p.columns]]));

	it("gives non-overlapping events the full width", () => {
		expect(columnsOf([span("a", 540, 600), span("b", 600, 660)])).toEqual({ a: [0, 1], b: [0, 1] });
	});

	it("splits overlapping events side by side", () => {
		expect(columnsOf([span("a", 540, 660), span("b", 570, 630)])).toEqual({ a: [0, 2], b: [1, 2] });
	});

	it("shares one column count across a chained cluster and reuses freed columns", () => {
		// a overlaps b, b overlaps c, a and c do not: c reuses a's column, all three split in two.
		// d starts after everything ends, so it is its own full-width cluster.
		expect(columnsOf([span("a", 540, 600), span("b", 570, 660), span("c", 600, 690), span("d", 700, 760)])).toEqual({
			a: [0, 2],
			b: [1, 2],
			c: [0, 2],
			d: [0, 1],
		});
	});
});
