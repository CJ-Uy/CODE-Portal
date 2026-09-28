import { getRepositories } from "@/db";
import { inclusiveEndDate, toIsoDate } from "@/lib/calendar";
import { icsFor } from "@/lib/calendar-export";
import { normalizeEventCode } from "@/lib/event-code";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * Calendar file for /events/<CODE>. Members only, matching the resolver next to it.
 *
 * Authorization is not re-implemented here: after resolving the code to an id, the event is loaded
 * through events.getById, which applies the normal visibility rules for this actor.
 */
export async function GET(request: Request, context: RouteContext) {
	const { code } = await context.params;
	const normalized = normalizeEventCode(code);
	if (!normalized) return new Response("Event not found.", { status: 404 });

	const repositories = await getRepositories();
	const resolved = await repositories.events.resolveShareCode(normalized).catch(() => null);
	if (!resolved) return new Response("Event not found.", { status: 404 });

	const actor = await getActor();
	if (!actor) {
		return new Response(null, {
			status: 302,
			headers: { Location: `/signin?next=${encodeURIComponent(`/events/${normalized}`)}` },
		});
	}

	const event = await repositories.events.getById(actor, resolved.id).catch(() => null);
	if (!event) return new Response("Event not found.", { status: 404 });

	const baseUrl = getAppConfig().APP_BASE_URL ?? new URL(request.url).origin;
	const shareUrl = `${baseUrl}/events/${normalized}`;

	const body = icsFor(
		{
			title: event.title,
			place: event.place,
			description: event.description,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			allDay: event.allDay,
			startDate: toIsoDate(event.startsAt),
			endDate: inclusiveEndDate(event.startsAt, event.endsAt),
			uid: `${event.id}@ateneocode.org`,
		},
		shareUrl,
	);

	return new Response(body, {
		headers: {
			"content-type": "text/calendar; charset=utf-8",
			"content-disposition": `attachment; filename="event-${normalized}.ics"`,
			"cache-control": "no-store",
		},
	});
}
