/**
 * Turns date-ranged calendar items into positioned bars for a month grid.
 *
 * The month grid is a flat list of weeks, each 7 cells of either an ISO day or null padding.
 * A bar that crosses a week boundary is emitted once per week, clipped to that week, because a
 * CSS grid row cannot span two rows. Callers place a bar with gridColumnStart/End, so no
 * measuring and no absolute positioning is involved.
 *
 * ISO "YYYY-MM-DD" strings compare correctly with < and >, so the whole module works on strings
 * and never constructs a Date. That sidesteps every timezone question — the caller has already
 * resolved days in UTC+8.
 */

export type CalendarBarInput = {
	id: string;
	startDate: string;
	endDate: string;
};

export type LaidOutBar<T extends CalendarBarInput> = {
	item: T;
	weekIndex: number;
	/** 1-based, inclusive, matching CSS grid column lines. */
	startCol: number;
	endCol: number;
	/** 0-based row within the week's bar layer. */
	lane: number;
	continuesLeft: boolean;
	continuesRight: boolean;
};

export type MonthBarLayout<T extends CalendarBarInput> = {
	bars: LaidOutBar<T>[];
	/** ISO day -> count of items that could not be shown, for the "+N more" affordance. */
	overflowByDay: Map<string, number>;
};

type Segment = { weekIndex: number; startCol: number; endCol: number; days: string[] };

/**
 * Clips one item to the days it actually covers inside a single week, ignoring padding cells.
 * Returns null when the item does not appear in that week at all.
 */
function segmentFor(item: CalendarBarInput, week: (string | null)[], weekIndex: number): Segment | null {
	const days: string[] = [];
	let startCol = 0;
	let endCol = 0;
	for (let index = 0; index < week.length; index += 1) {
		const iso = week[index];
		if (!iso) continue;
		if (iso < item.startDate || iso > item.endDate) continue;
		const column = index + 1;
		if (startCol === 0) startCol = column;
		endCol = column;
		days.push(iso);
	}
	if (startCol === 0) return null;
	return { weekIndex, startCol, endCol, days };
}

/**
 * Longest bars first so they settle into the top lanes and read as the spine of the week;
 * id breaks ties so the layout does not shuffle between renders of the same data.
 */
function compare(a: CalendarBarInput, b: CalendarBarInput): number {
	if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
	const aSpan = a.endDate;
	const bSpan = b.endDate;
	if (aSpan !== bSpan) return aSpan > bSpan ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function layoutMonthBars<T extends CalendarBarInput>(
	items: T[],
	weeks: Array<Array<string | null>>,
	maxLanes: number,
): MonthBarLayout<T> {
	const bars: LaidOutBar<T>[] = [];
	const overflowByDay = new Map<string, number>();

	const ordered = [...items].sort(compare);

	// Lanes are tracked per week: occupancy[weekIndex][lane] is the set of columns already taken.
	// A bar crossing a week boundary is two independent segments, so each week packs on its own.
	const occupancy: Array<Array<Set<number>>> = weeks.map(() => []);

	for (const item of ordered) {
		for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
			const segment = segmentFor(item, weeks[weekIndex], weekIndex);
			if (!segment) continue;

			const lanes = occupancy[weekIndex];
			let lane = 0;
			for (; lane < maxLanes; lane += 1) {
				if (!lanes[lane]) lanes[lane] = new Set<number>();
				let free = true;
				for (let column = segment.startCol; column <= segment.endCol; column += 1) {
					if (lanes[lane].has(column)) {
						free = false;
						break;
					}
				}
				if (free) break;
			}

			if (lane >= maxLanes) {
				// No room: the item still has to be accounted for on every day it covers.
				for (const iso of segment.days) {
					overflowByDay.set(iso, (overflowByDay.get(iso) ?? 0) + 1);
				}
				continue;
			}

			for (let column = segment.startCol; column <= segment.endCol; column += 1) {
				lanes[lane].add(column);
			}

			const firstIso = weeks[weekIndex][segment.startCol - 1] as string;
			const lastIso = weeks[weekIndex][segment.endCol - 1] as string;
			bars.push({
				item,
				weekIndex,
				startCol: segment.startCol,
				endCol: segment.endCol,
				lane,
				continuesLeft: item.startDate < firstIso,
				continuesRight: item.endDate > lastIso,
			});
		}
	}

	return { bars, overflowByDay };
}

/** Splits a flat 7-column cell array into week rows. */
export function toWeeks(cells: Array<string | null>): Array<Array<string | null>> {
	const weeks: Array<Array<string | null>> = [];
	for (let index = 0; index < cells.length; index += 7) {
		weeks.push(cells.slice(index, index + 7));
	}
	return weeks;
}
