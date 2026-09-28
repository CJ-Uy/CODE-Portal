export type CalendarSource = "event" | "birthday" | "term_deadline";

export type CalendarItem = {
	id: string;
	source: CalendarSource;
	title: string;
	date: string;
	/** Inclusive last day the item occupies. Equals `date` for single-day items. */
	endDate: string;
	startsAt: string | null;
	endsAt: string | null;
	eventId: string | null;
	href: string | null;
	/** Event-type colour token; birthdays and term deadlines carry their source default. */
	colour: string;
	readOnly: boolean;
};

/**
 * The inclusive last day an event occupies.
 *
 * An event ending at exactly midnight UTC+8 occupies NONE of that day, but `toIsoDate` maps the
 * instant forward to it — rendering a bar one day too long. Stepping back 1ms lands on the last day
 * actually occupied. The floor guards a zero-length event starting exactly at midnight, where the
 * step back would otherwise walk into the previous day.
 */
export function inclusiveEndDate(startsAt: Date, endsAt: Date | null): string {
	const startDay = toIsoDate(startsAt);
	if (!endsAt) return startDay;
	const lastInstant = toIsoDate(new Date(endsAt.getTime() - 1));
	return lastInstant > startDay ? lastInstant : startDay;
}

export function monthRange(year: number, month: number): { start: Date; end: Date } {
	const start = new Date(Date.UTC(year, month - 1, 1, -8, 0, 0, 0));
	const end = new Date(Date.UTC(year, month, 1, -8, 0, 0, 0));
	return { start, end };
}

export function toIsoDate(date: Date): string {
	return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
