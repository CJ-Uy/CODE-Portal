import type { getRepositories } from "@/db";
import type { requireActor } from "@/server/auth/actor";
import type { EventListItem } from "./events-list";

export async function loadEventList(
	repositories: Awaited<ReturnType<typeof getRepositories>>,
	actor: Awaited<ReturnType<typeof requireActor>>,
): Promise<EventListItem[]> {
	const pageSize = 100;
	const events: Awaited<ReturnType<typeof repositories.events.listPublished>> = [];
	// ponytail: load the full event history; add cursor paging if the calendar reaches thousands of events.
	for (let offset = 0; ; offset += pageSize) {
		const page = await repositories.events.listPublished(actor, { limit: pageSize, offset });
		events.push(...page);
		if (page.length < pageSize) break;
	}
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
	}));
}
