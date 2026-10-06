import { describe, expect, it } from "vitest";
import { buildRetentionStats, competitionRanks, neededPerWeek, projectedDateFor, type StatRecord } from "./retention-stats";

const term = { startsAt: new Date("2026-08-03T00:00:00Z"), endsAt: new Date("2026-10-26T00:00:00Z") }; // 12 weeks
const record = (iso: string, points: number, eventId: string | null = null): StatRecord => ({
	points,
	recordedAt: new Date(iso),
	source: eventId ? "event_attendance" : "manual",
	eventId,
});

describe("buildRetentionStats", () => {
	const now = new Date("2026-08-31T12:00:00Z"); // day 29, week index 4
	const stats = buildRetentionStats(
		[
			record("2026-08-04T10:00:00Z", 2, "ev_1"),
			record("2026-08-19T10:00:00Z", 1.5, "ev_2"),
			record("2026-08-25T10:00:00Z", 3, "ev_3"),
			record("2026-08-26T10:00:00Z", 0.5),
		],
		term,
		now,
	);

	it("totals, buckets, and counts events", () => {
		expect(stats.total).toBe(7);
		expect(stats.events).toBe(3);
		expect(stats.weeks).toHaveLength(12);
		expect(stats.weeks.map((week) => week.points).slice(0, 5)).toEqual([2, 0, 1.5, 3.5, 0]);
		expect(stats.bestWeek).toBe(3.5);
		expect(stats.weeks[5].future).toBe(true);
		expect(stats.cumulative.at(-1)?.total).toBe(7);
	});

	it("does not let the in-progress week break the streak", () => {
		expect(stats.streak).toBe(2);
	});

	it("projects at the current pace", () => {
		expect(stats.elapsedDays).toBe(29);
		expect(stats.daysLeft).toBe(56);
		expect(stats.projectedTotal).toBeCloseTo(7 + (7 / 29) * 56, 1);
		expect(projectedDateFor(stats, 5, now)).toBeNull();
		expect(projectedDateFor(stats, 10, now)!.getTime()).toBeGreaterThan(now.getTime());
		expect(neededPerWeek(stats, 15)).toBe(1);
	});

	it("handles an empty term", () => {
		const empty = buildRetentionStats([], term, now);
		expect(empty.total).toBe(0);
		expect(empty.streak).toBe(0);
		expect(projectedDateFor(empty, 10, now)).toBeNull();
	});
});

describe("competitionRanks", () => {
	it("shares ranks on ties", () => {
		expect(competitionRanks([10, 8, 8, 5])).toEqual([1, 2, 2, 4]);
	});
});
