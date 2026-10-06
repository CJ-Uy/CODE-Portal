import { quantizePoints } from "@/lib/points";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type StatRecord = {
	points: number | null;
	recordedAt: Date;
	source: "event_attendance" | "manual";
	eventId: string | null;
};

export type TermWindow = { startsAt: Date; endsAt: Date };

export type WeekBucket = { index: number; startsAt: Date; points: number; future: boolean };

export type RetentionStats = {
	total: number;
	events: number;
	weeks: WeekBucket[];
	/** Running total after each record, oldest first, opening at the term start with 0. */
	cumulative: Array<{ at: Date; total: number }>;
	weeklyAverage: number;
	bestWeek: number;
	/** Consecutive weeks with points, counted back from the current week. */
	streak: number;
	daysLeft: number;
	elapsedDays: number;
	totalDays: number;
	/** Points per day so far; the projection assumes this pace holds. */
	pacePerDay: number;
	projectedTotal: number;
};

/**
 * Weeks are anchored on the term start, not calendar weeks, so "week 1" is always the
 * first seven days of term and the last bucket never straddles two terms.
 */
export function buildRetentionStats(records: StatRecord[], term: TermWindow, now: Date): RetentionStats {
	const start = term.startsAt.getTime();
	const end = Math.max(start + DAY_MS, term.endsAt.getTime());
	const clock = Math.min(Math.max(now.getTime(), start), end);

	const sorted = [...records].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
	let running = 0;
	const cumulative = [{ at: new Date(start), total: 0 }];
	for (const record of sorted) {
		running = quantizePoints(running + (record.points ?? 0));
		cumulative.push({ at: record.recordedAt, total: running });
	}
	const total = running;

	const weekCount = Math.max(1, Math.ceil((end - start) / WEEK_MS));
	const currentWeek = Math.min(weekCount - 1, Math.floor((clock - start) / WEEK_MS));
	const weeks: WeekBucket[] = Array.from({ length: weekCount }, (_, index) => ({
		index,
		startsAt: new Date(start + index * WEEK_MS),
		points: 0,
		future: index > currentWeek,
	}));
	for (const record of sorted) {
		const index = Math.floor((record.recordedAt.getTime() - start) / WEEK_MS);
		const week = weeks[Math.min(Math.max(index, 0), weekCount - 1)];
		week.points = quantizePoints(week.points + (record.points ?? 0));
	}

	// The current week is still in progress, so an empty one does not break the streak yet.
	let streak = 0;
	for (let index = weeks[currentWeek].points > 0 ? currentWeek : currentWeek - 1; index >= 0; index--) {
		if (weeks[index].points <= 0) break;
		streak++;
	}

	const elapsedDays = Math.max(1, Math.ceil((clock - start) / DAY_MS));
	const totalDays = Math.ceil((end - start) / DAY_MS);
	const daysLeft = Math.max(0, Math.ceil((end - Math.max(now.getTime(), start)) / DAY_MS));
	const pacePerDay = total / elapsedDays;

	return {
		total,
		events: new Set(sorted.filter((record) => record.source === "event_attendance").map((record) => record.eventId ?? record.recordedAt.toISOString())).size,
		weeks,
		cumulative,
		weeklyAverage: quantizePoints(total / Math.max(1, currentWeek + 1)),
		bestWeek: Math.max(0, ...weeks.map((week) => week.points)),
		streak,
		daysLeft,
		elapsedDays,
		totalDays,
		pacePerDay,
		projectedTotal: quantizePoints(total + pacePerDay * daysLeft),
	};
}

/** When the current pace reaches `target`, or null when there is no pace to project. */
export function projectedDateFor(stats: RetentionStats, target: number, now: Date): Date | null {
	if (stats.total >= target) return null;
	if (stats.pacePerDay <= 0) return null;
	return new Date(now.getTime() + ((target - stats.total) / stats.pacePerDay) * DAY_MS);
}

/** Points per week still needed to reach `target` by term end; 0 once reached. */
export function neededPerWeek(stats: RetentionStats, target: number): number {
	const remaining = target - stats.total;
	if (remaining <= 0) return 0;
	return quantizePoints(remaining / Math.max(1, stats.daysLeft / 7));
}

/** Competition ranking: ties share a rank, and the next distinct score skips past them. */
export function competitionRanks(totals: number[]): number[] {
	return totals.map((value) => 1 + totals.filter((other) => other > value).length);
}
