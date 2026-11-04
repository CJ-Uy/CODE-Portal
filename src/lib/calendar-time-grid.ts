/**
 * Day math and timed-event layout for the calendar's Week and Day views.
 *
 * Days are ISO "YYYY-MM-DD" strings already resolved in Asia/Manila. Day arithmetic runs on UTC
 * midnights so it never depends on the Worker's own clock zone; anything reading an instant pins
 * the +08:00 offset explicitly.
 */

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shortest block drawn for a timed event, so a 10-minute or open-ended event stays tappable. */
export const MIN_BLOCK_MINUTES = 30;

export function dayViewHref(iso: string): string {
	return `/portal/calendar?view=day&date=${iso}`;
}

export function addDays(iso: string, days: number): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A `?date=` value if it names a real day, else null. "2026-02-30" is rejected, not rolled over. */
export function parseIsoDay(value: string | undefined): string | null {
	if (!value || !ISO_DAY.test(value)) return null;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : value;
}

/** The seven days of the Sunday-first week containing `iso`, matching the month grid. */
export function weekDays(iso: string): string[] {
	const start = addDays(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay());
	return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Minutes from Manila midnight of `dayIso` to `instantIso`. Negative or past 1440 when off that day. */
export function minutesIntoDay(instantIso: string, dayIso: string): number {
	return (Date.parse(instantIso) - Date.parse(`${dayIso}T00:00:00+08:00`)) / 60_000;
}

export type TimedSpan = { id: string; start: number; end: number };

/**
 * Start and end minutes of a single-day timed event on its day. An open end draws an hour; anything
 * shorter than MIN_BLOCK_MINUTES is stretched so it still reads as a block. An end at the following
 * midnight is 1440, the bottom of the day.
 */
export function timedSpan(
	item: { id: string; date: string; startsAt: string; endsAt: string | null },
): TimedSpan {
	const start = Math.max(0, minutesIntoDay(item.startsAt, item.date));
	const rawEnd = item.endsAt ? minutesIntoDay(item.endsAt, item.date) : start + 60;
	const end = Math.min(1440, Math.max(rawEnd, start + MIN_BLOCK_MINUTES));
	return { id: item.id, start: Math.min(start, end - MIN_BLOCK_MINUTES), end };
}

/**
 * The hours the grid draws: a working-day default, widened to the whole hour around any event
 * outside it, so an early call or late session never falls off the grid.
 */
export function hourRange(spans: TimedSpan[], defaultStart = 7, defaultEnd = 22): { startHour: number; endHour: number } {
	let startHour = defaultStart;
	let endHour = defaultEnd;
	for (const span of spans) {
		startHour = Math.min(startHour, Math.floor(span.start / 60));
		endHour = Math.max(endHour, Math.ceil(span.end / 60));
	}
	return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export type TimedPlacement<T extends TimedSpan> = {
	item: T;
	/** 0-based column within its overlap cluster. */
	column: number;
	/** Columns the cluster splits into, so the block's width is 1/columns of the day. */
	columns: number;
};

/**
 * Side-by-side columns for overlapping events in one day. Events that overlap, directly or through
 * a chain, form a cluster sharing one column count; each takes the first column free at its start.
 * An event starting exactly when another ends reuses that column, since they do not overlap.
 */
export function layoutTimedEvents<T extends TimedSpan>(spans: T[]): TimedPlacement<T>[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const placements: TimedPlacement<T>[] = [];
	let cluster: Array<{ item: T; column: number }> = [];
	let columnEnds: number[] = [];
	let clusterEnd = -Infinity;

	const flush = () => {
		for (const entry of cluster) placements.push({ ...entry, columns: columnEnds.length });
		cluster = [];
		columnEnds = [];
	};

	for (const item of sorted) {
		if (item.start >= clusterEnd) flush();
		let column = columnEnds.findIndex((end) => end <= item.start);
		if (column === -1) {
			column = columnEnds.length;
			columnEnds.push(item.end);
		} else {
			columnEnds[column] = item.end;
		}
		cluster.push({ item, column });
		clusterEnd = cluster.length === 1 ? item.end : Math.max(clusterEnd, item.end);
	}
	flush();
	return placements;
}
