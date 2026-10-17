import type { EventFeedbackRow } from "@/db/types";

// Pure helpers behind the admin event archive list and the planning link on the event creation form. Client-safe: types only from the db layer.

export const ARCHIVE_PATH = "/portal/admin/data/events";

const NONE = "—";

type ArchiveRow = { eventId: string; title: string; type: string; status: string; place: string; startsAt: Date };

/** The archive URL with only the filters that are set, so changing one control keeps the others. */
export function archiveHref(params: { termId?: string; q?: string; type?: string } = {}): string {
	const search = new URLSearchParams();
	for (const key of ["termId", "q", "type"] as const) {
		const value = params[key];
		if (value) search.set(key, value);
	}
	const query = search.toString();
	return query ? `${ARCHIVE_PATH}?${query}` : ARCHIVE_PATH;
}

/** Distinct event types for the filter, sorted. The selected type stays in the list even when this term has no such event. */
export function archiveTypes(rows: Pick<ArchiveRow, "type">[], selected?: string): string[] {
	const types = new Set(rows.map((row) => row.type));
	if (selected) types.add(selected);
	return [...types].sort((a, b) => a.localeCompare(b));
}

/** Applies the search and type filters, newest event first. */
export function archiveRows<T extends ArchiveRow>(rows: T[], filters: { q?: string; type?: string }): T[] {
	const q = filters.q?.toLowerCase() ?? "";
	return rows
		.filter((row) => !filters.type || row.type === filters.type)
		.filter((row) => !q || [row.title, row.type, row.status, row.place].some((value) => value.toLowerCase().includes(q)))
		.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || b.eventId.localeCompare(a.eventId));
}

export type FeedbackCells = { topTwo: string; responses: string; rate: string; debrief: boolean };

/** The four feedback columns for one archive row. An event with no form and no debrief has no entry at all. */
export function feedbackCells(entry: EventFeedbackRow | undefined): FeedbackCells {
	const topTwo = entry?.overall?.topTwoPct;
	return {
		// overall is already null below the anonymity floor, so "—" also covers "too few answers".
		topTwo: topTwo === null || topTwo === undefined ? NONE : `${topTwo}%`,
		responses: entry?.surveyId ? String(entry.responses) : NONE,
		rate: entry?.invitedRate === null || entry?.invitedRate === undefined ? NONE : `${Math.round(entry.invitedRate * 100)}%`,
		debrief: entry?.hasDebrief ?? false,
	};
}

/** The "look back before you plan" link on the event creation form. `label` is the type's display name. */
export function planningLink(type: string, label: string): { href: string; text: string } {
	return { href: archiveHref({ type }), text: `See feedback from past ${label} events` };
}
