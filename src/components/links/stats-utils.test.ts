import { describe, expect, it } from "vitest";
import { dailyTrendSeries, formatStatsPoint, hourlyTrendSeries, normalizeDateRange, presetDateRange, summarizeTrend, todayInTimeZone, trendSeries } from "./stats-utils";

const series = [
	{ date: "2026-06-17", count: 3 },
	{ date: "2026-06-19", count: 7 },
	{ date: "2026-06-24", count: 4 },
];

describe("link stats utilities", () => {
	it("builds quick ranges and fills quiet days", () => {
		const range = presetDateRange("7d", "2026-06-24", series);
		expect(range).toEqual({ start: "2026-06-18", end: "2026-06-24" });
		expect(dailyTrendSeries(series, range)).toEqual([
			{ date: "2026-06-18", count: 0 },
			{ date: "2026-06-19", count: 7 },
			{ date: "2026-06-20", count: 0 },
			{ date: "2026-06-21", count: 0 },
			{ date: "2026-06-22", count: 0 },
			{ date: "2026-06-23", count: 0 },
			{ date: "2026-06-24", count: 4 },
		]);
	});

	it("normalizes custom ranges and summarizes against the previous period", () => {
		const range = normalizeDateRange("2026-06-24", "2026-06-18");
		expect(range).toEqual({ start: "2026-06-18", end: "2026-06-24" });
		expect(summarizeTrend(series, range)).toMatchObject({
			total: 11,
			activeDays: 2,
			peak: { date: "2026-06-19", count: 7 },
			previousTotal: 3,
			change: 8,
		});
	});

	it("groups longer views by week or month", () => {
		expect(trendSeries(series, { start: "2026-06-01", end: "2026-06-30" }, "week")).toEqual([
			{ date: "2026-06-15", count: 10 },
			{ date: "2026-06-22", count: 4 },
		]);
		expect(trendSeries(series, { start: "2026-06-01", end: "2026-06-30" }, "month")).toEqual([{ date: "2026-06", count: 14 }]);
	});

	it("fills hourly buckets for short ranges", () => {
		const hourly = hourlyTrendSeries(
			[
				{ hour: "2026-06-24T09:00", count: 2 },
				{ hour: "2026-06-24T11:00", count: 5 },
			],
			{ start: "2026-06-24", end: "2026-06-24" },
		);

		expect(hourly).toHaveLength(24);
		expect(hourly[9]).toEqual({ date: "2026-06-24T09:00", count: 2 });
		expect(hourly[10]).toEqual({ date: "2026-06-24T10:00", count: 0 });
		expect(hourly[11]).toEqual({ date: "2026-06-24T11:00", count: 5 });
	});

	it("uses the selected timezone for today's date", () => {
		const instant = new Date("2026-06-24T16:30:00Z");
		expect(todayInTimeZone("Asia/Manila", instant)).toBe("2026-06-25");
		expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-06-24");
	});

	it("keeps repeated DST hours distinct and labels their offsets", () => {
		const repeated = hourlyTrendSeries([
			{ hour: "2026-11-01T01:00-04:00", count: 2 },
			{ hour: "2026-11-01T01:00-05:00", count: 3 },
		], { start: "2026-11-01", end: "2026-11-01" });
		expect(repeated).toEqual([
			{ date: "2026-11-01T01:00-04:00", count: 2 },
			{ date: "2026-11-01T01:00-05:00", count: 3 },
		]);
		expect(formatStatsPoint(repeated[0].date)).toBe("Nov 1, 1 AM UTC-04:00");
		expect(formatStatsPoint(repeated[1].date)).toBe("Nov 1, 1 AM UTC-05:00");
	});
});
