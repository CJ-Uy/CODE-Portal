import { describe, expect, it } from "vitest";
import { layoutMonthBars, toWeeks, type CalendarBarInput } from "./calendar-layout";

// August 2026 starts on a Saturday, so the first week has five leading padding cells.
// Sunday-first, matching calendar-month.tsx (buildMonthGrid is Monday-first and is NOT used here).
const AUGUST_2026 = toWeeks([
	null, null, null, null, null, null, "2026-08-01",
	"2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08",
	"2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15",
	"2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22",
	"2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29",
	"2026-08-30", "2026-08-31", null, null, null, null, null,
]);

function bar(id: string, startDate: string, endDate: string): CalendarBarInput {
	return { id, startDate, endDate };
}

describe("calendar bar layout", () => {
	it("places a single-day item in one cell with no continuation", () => {
		const { bars } = layoutMonthBars([bar("a", "2026-08-12", "2026-08-12")], AUGUST_2026, 3);
		expect(bars).toHaveLength(1);
		expect(bars[0]).toMatchObject({ weekIndex: 2, startCol: 4, endCol: 4, lane: 0, continuesLeft: false, continuesRight: false });
	});

	it("spans a multi-day item across columns within one week", () => {
		const { bars } = layoutMonthBars([bar("a", "2026-08-12", "2026-08-14")], AUGUST_2026, 3);
		expect(bars).toHaveLength(1);
		expect(bars[0]).toMatchObject({ startCol: 4, endCol: 6, continuesLeft: false, continuesRight: false });
	});

	it("splits an item crossing a week boundary into two clipped bars", () => {
		// Thu Aug 13 through Mon Aug 17 straddles the Sat/Sun break.
		const { bars } = layoutMonthBars([bar("a", "2026-08-13", "2026-08-17")], AUGUST_2026, 3);
		expect(bars).toHaveLength(2);

		const [first, second] = bars.sort((x, y) => x.weekIndex - y.weekIndex);
		expect(first).toMatchObject({ weekIndex: 2, startCol: 5, endCol: 7, continuesLeft: false, continuesRight: true });
		expect(second).toMatchObject({ weekIndex: 3, startCol: 1, endCol: 2, continuesLeft: true, continuesRight: false });
	});

	it("clips at the month edges without covering padding cells", () => {
		// Starts before the month and ends after it.
		const { bars } = layoutMonthBars([bar("a", "2026-07-28", "2026-09-02")], AUGUST_2026, 3);
		const firstWeek = bars.find((b) => b.weekIndex === 0);
		const lastWeek = bars.find((b) => b.weekIndex === 5);

		// Aug 1 sits in the last column of the padded first week.
		expect(firstWeek).toMatchObject({ startCol: 7, endCol: 7, continuesLeft: true, continuesRight: true });
		// Aug 31 is the second column of the final week; the trailing padding is not covered.
		// It still continues right: the item runs to Sep 2, past the end of this grid.
		expect(lastWeek).toMatchObject({ startCol: 1, endCol: 2, continuesLeft: true, continuesRight: true });
	});

	it("stacks overlapping items into separate lanes", () => {
		const { bars, overflowByDay } = layoutMonthBars(
			[bar("a", "2026-08-10", "2026-08-12"), bar("b", "2026-08-11", "2026-08-13"), bar("c", "2026-08-12", "2026-08-14")],
			AUGUST_2026,
			3,
		);
		expect(bars).toHaveLength(3);
		expect(bars.map((b) => b.lane).sort()).toEqual([0, 1, 2]);
		expect(overflowByDay.size).toBe(0);
	});

	it("reuses a lane once an earlier bar has ended", () => {
		const { bars } = layoutMonthBars(
			[bar("a", "2026-08-10", "2026-08-11"), bar("b", "2026-08-13", "2026-08-14")],
			AUGUST_2026,
			3,
		);
		// Disjoint spans, so both belong on the top lane.
		expect(bars.every((b) => b.lane === 0)).toBe(true);
	});

	it("overflows the fourth overlapping item and counts it on every day it covers", () => {
		const { bars, overflowByDay } = layoutMonthBars(
			[
				bar("a", "2026-08-10", "2026-08-12"),
				bar("b", "2026-08-10", "2026-08-12"),
				bar("c", "2026-08-10", "2026-08-12"),
				bar("d", "2026-08-10", "2026-08-12"),
			],
			AUGUST_2026,
			3,
		);
		expect(bars).toHaveLength(3);
		expect(overflowByDay.get("2026-08-10")).toBe(1);
		expect(overflowByDay.get("2026-08-11")).toBe(1);
		expect(overflowByDay.get("2026-08-12")).toBe(1);
	});

	it("omits an item that falls entirely outside the grid", () => {
		const { bars, overflowByDay } = layoutMonthBars([bar("a", "2026-06-01", "2026-06-03")], AUGUST_2026, 3);
		expect(bars).toHaveLength(0);
		expect(overflowByDay.size).toBe(0);
	});

	it("is stable: the same input yields the same lanes", () => {
		const items = [bar("b", "2026-08-10", "2026-08-12"), bar("a", "2026-08-10", "2026-08-12")];
		const first = layoutMonthBars(items, AUGUST_2026, 3);
		const second = layoutMonthBars([...items].reverse(), AUGUST_2026, 3);
		const lanesOf = (result: typeof first) =>
			result.bars.map((b) => `${b.item.id}:${b.lane}`).sort();
		expect(lanesOf(first)).toEqual(lanesOf(second));
	});

	it("gives longer bars the higher lane when they start together", () => {
		const { bars } = layoutMonthBars(
			[bar("short", "2026-08-10", "2026-08-10"), bar("long", "2026-08-10", "2026-08-14")],
			AUGUST_2026,
			3,
		);
		expect(bars.find((b) => b.item.id === "long")?.lane).toBe(0);
		expect(bars.find((b) => b.item.id === "short")?.lane).toBe(1);
	});

	it("splits a flat cell array into week rows of seven", () => {
		const weeks = toWeeks(Array.from({ length: 42 }, (_, i) => `d${i}`));
		expect(weeks).toHaveLength(6);
		expect(weeks[0]).toHaveLength(7);
	});
});
