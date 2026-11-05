import type { getRepositories } from "@/db";
import type { requireActor } from "@/server/auth/actor";
import type { EventListItem } from "./events-list";

export async function loadEventList(
	repositories: Awaited<ReturnType<typeof getRepositories>>,
	actor: Awaited<ReturnType<typeof requireActor>>,
): Promise<EventListItem[]> {
	const pageSize = 100;
	const events: Awaited<ReturnType<typeof repositories.events.listPublished>> = [];
	// The viewer's RSVPs and check-ins feed the Going and Attended filters. A failed read only empties those.
	const marksRead = repositories.calendar.myEventMarks(actor).catch(() => ({ going: [], attended: [] }));
	// ponytail: load the full event history; add cursor paging if the calendar reaches thousands of events.
	for (let offset = 0; ; offset += pageSize) {
		const page = await repositories.events.listPublished(actor, { limit: pageSize, offset });
		events.push(...page);
		if (page.length < pageSize) break;
	}
	const marks = await marksRead;
	const going = new Set(marks.going);
	const attended = new Set(marks.attended);
	return events.map((event) => ({
		id: event.id,
		title: event.title,
		type: event.type,
		place: event.place,
		startsAt: event.startsAt,
		endsAt: event.endsAt,
		allDay: Boolean(event.allDay),
		readOnly: Boolean(event.readOnly),
		myRole: event.myRole,
		canModerate: event.canModerate,
		going: going.has(event.id),
		attended: attended.has(event.id),
	}));
}
