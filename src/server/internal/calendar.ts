import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { calendarContract } from "@/db/contract/calendar";
import { createCalendarRepository } from "@/db/repositories/calendar";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type CalendarInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createCalendarInternalHandlers({ db, deployEnv, allowedOrigins = [] }: CalendarInternalDependencies) {
	const repository = createCalendarRepository(db);

	return {
		async fetch(request: Request): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });

			const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
			if (request.method === "OPTIONS") {
				return new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined });
			}
			if (request.headers.has("origin") && !corsHeaders) {
				return Response.json({ error: "Origin is not allowed." }, { status: 403 });
			}
			const responseHeaders = corsHeaders ?? undefined;

			const actor = await resolveSharedActor(db, request);
			if (!actor) {
				return Response.json({ error: "Invalid shared development token." }, { status: 401, headers: responseHeaders });
			}

			try {
				if (request.method === "GET") {
					const url = new URL(request.url);
					const eventId = url.searchParams.get("eventId");
					if (eventId) {
						const input = calendarContract.getEvent.input.parse({ eventId });
						const event = await repository.getEvent(actor, input.eventId);
						const output = calendarContract.getEvent.output.parse({ event });
						return Response.json(output, { status: event ? 200 : 404, headers: responseHeaders });
					}
					const input = calendarContract.getMonth.input.parse({
						year: Number(url.searchParams.get("year")),
						month: Number(url.searchParams.get("month")),
					});
					const items = await repository.getMonth(actor, input);
					const output = calendarContract.getMonth.output.parse({ items });
					return Response.json(output, { headers: responseHeaders });
				}
				return new Response("Method not allowed", { status: 405, headers: responseHeaders });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Internal request failed.";
				const status = message.startsWith("Not authorized") ? 403 : 400;
				return Response.json({ error: message }, { status, headers: responseHeaders });
			}
		},
	};
}
