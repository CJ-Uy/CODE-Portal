import { getRepositories } from "@/db";
import { normalizeEventCode } from "@/lib/event-code";
import { getActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * Resolves a short share code to the real event page: ateneocode.org/events/K7P2QM
 *
 * This is a RESOLVER, not an authorization boundary. It never decides who may see an event — it
 * redirects to /portal/calendar/<id>, which applies the normal visibility rules. Holding a code
 * therefore grants nothing; it only shortens a URL.
 *
 * It is also the one event route an unauthenticated request can reach, so the lookup selects the
 * id alone. In particular it must never read checkin_secret, which is what gates QR check-in.
 */
export async function GET(_request: Request, context: RouteContext) {
	const { code } = await context.params;
	const normalized = normalizeEventCode(code);
	// Malformed codes 404 without touching the database, so the route cannot be used to amplify
	// load by hammering it with garbage.
	if (!normalized) return notFound();

	const repositories = await getRepositories();
	const event = await repositories.events.resolveShareCode(normalized).catch(() => null);
	if (!event) return notFound();

	const actor = await getActor();
	if (!actor) {
		// Members only: bounce through sign-in and come back. The `next` value is built here from a
		// validated code, never echoed from user input, so it cannot become an open redirect.
		return redirect(`/signin?next=${encodeURIComponent(`/events/${normalized}`)}`);
	}

	return redirect(`/portal/calendar/${event.id}`);
}

function redirect(location: string): Response {
	return new Response(null, { status: 302, headers: { Location: location } });
}

function notFound(): Response {
	return new Response("Event not found.", { status: 404, headers: { "content-type": "text/plain" } });
}
