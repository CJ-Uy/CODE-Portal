import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { isFeatureEnabled } from "@/server/features";
import { assertSameOrigin } from "@/server/http/origin";
import { enforceRateLimit } from "@/server/ratelimit/guard";
import { RATE_LIMITS } from "@/server/ratelimit/policies";

const bodySchema = z.object({
	kind: z.enum(["open", "active", "download"]),
	seconds: z.number().int().min(0).max(600).optional(),
});

/** Reading pings from the item page: an open, a stretch of active time, or a download. The repository decides what is credited. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	// ponytail: the library has no /internal contract yet, so shared dev mode has nothing to record into.
	if (!isFeatureEnabled("library") || config.APP_ENV === "shared") return new Response(null, { status: 404 });
	const actor = await getActor();
	if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });

	const { getDb } = await import("@/db/client");
	const limited = await enforceRateLimit(getDb(), "libraryActivity", actor.memberId, RATE_LIMITS.libraryActivity);
	if (limited) return limited;

	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return Response.json({ error: "Invalid activity ping." }, { status: 400 });

	const { id } = await params;
	const repositories = await getRepositories();
	await repositories.libraryActivity.record(actor, id, body.data);
	return new Response(null, { status: 204 });
}
