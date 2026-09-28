import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { eventsContract } from "@/db/contract/events";
import { createAuditRepository } from "@/db/repositories/audit";
import { createEventForumRepository } from "@/db/repositories/event-forum";
import { createEventMediaRepository } from "@/db/repositories/event-media";
import { createEventsRepository } from "@/db/repositories/events";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type EventsInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createEventsInternalHandlers({ db, deployEnv, allowedOrigins = [] }: EventsInternalDependencies) {
	const audit = createAuditRepository(db);
	const repository = createEventsRepository(db, audit);
	const forum = createEventForumRepository(db, audit);
	const mediaRepository = createEventMediaRepository(db, audit);

	async function readBody(request: Request) {
		const text = await request.text();
		return text ? JSON.parse(text) : {};
	}

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
				const url = new URL(request.url);
				const op = url.searchParams.get("op") ?? "listPublished";

				if (request.method === "GET" && op === "listPublished") {
					const input = eventsContract.listPublished.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
						offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
					});
					const events = await repository.listPublished(actor, input);
					return Response.json(eventsContract.listPublished.output.parse({ events }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "searchMembers") {
					const input = eventsContract.searchMembers.input.parse({
						eventId: url.searchParams.get("eventId"),
						query: url.searchParams.get("query"),
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					});
					const members = await repository.searchAttendableMembers(actor, input);
					return Response.json(eventsContract.searchMembers.output.parse({ members }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "listAttendance") {
					const input = eventsContract.listAttendance.input.parse({ eventId: url.searchParams.get("eventId") });
					const attendance = await repository.listAttendance(actor, input.eventId);
					return Response.json(eventsContract.listAttendance.output.parse({ attendance }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "listInvites") {
					const input = eventsContract.listInvites.input.parse({ eventId: url.searchParams.get("eventId") });
					const invites = await repository.listInvites(actor, input.eventId);
					return Response.json(eventsContract.listInvites.output.parse({ invites }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "listStaff") {
					const input = eventsContract.listStaff.input.parse({ eventId: url.searchParams.get("eventId") });
					const staff = await repository.listStaff(actor, input.eventId);
					return Response.json(eventsContract.listStaff.output.parse({ staff }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "listForumPosts") {
					const input = eventsContract.listForumPosts.input.parse({
						eventId: url.searchParams.get("eventId"),
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
						offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
					});
					const posts = await forum.listForEvent(actor, input.eventId, input);
					return Response.json(eventsContract.listForumPosts.output.parse({ posts }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "listMedia") {
					const input = eventsContract.listMedia.input.parse({ eventId: url.searchParams.get("eventId") });
					const media = await mediaRepository.listForEvent(actor, input.eventId);
					return Response.json(eventsContract.listMedia.output.parse({ media }), { headers: responseHeaders });
				}

				if (request.method === "POST") {
					const operationDef = eventsContract[op as keyof typeof eventsContract];
					if (!operationDef) {
						return Response.json({ error: "Unknown operation." }, { status: 400, headers: responseHeaders });
					}
					if (operationDef.sharedDev === "deny") {
						return Response.json(
							{ error: "Operation is disabled in shared development." },
							{ status: 403, headers: responseHeaders },
						);
					}
					const body = await readBody(request);
					const bodyWithParams = body && typeof body === "object" ? { ...body, ...Object.fromEntries(url.searchParams) } : Object.fromEntries(url.searchParams);
					if (op === "rsvp") {
						const input = eventsContract.rsvp.input.parse(bodyWithParams);
						const result = await repository.setRsvp(actor, input);
						return Response.json(eventsContract.rsvp.output.parse(result), { headers: responseHeaders });
					}
					if (op === "scan") {
						const input = eventsContract.scan.input.parse(bodyWithParams);
						const result = await repository.recordScan(actor, input);
						return Response.json(eventsContract.scan.output.parse(result), { headers: responseHeaders });
					}
					if (op === "post") {
						const input = eventsContract.post.input.parse(bodyWithParams);
						const post = await forum.post(actor, input);
						return Response.json(eventsContract.post.output.parse({ post }), { status: 201, headers: responseHeaders });
					}
					if (op === "revealAuthor") {
						const input = eventsContract.revealAuthor.input.parse(bodyWithParams);
						const author = await forum.revealAuthor(actor, input.postId);
						return Response.json(eventsContract.revealAuthor.output.parse({ author }), { headers: responseHeaders });
					}
					if (op === "addMedia") {
						const input = eventsContract.addMedia.input.parse(bodyWithParams);
						const media = await mediaRepository.add(actor, input);
						return Response.json(eventsContract.addMedia.output.parse({ media }), { status: 201, headers: responseHeaders });
					}
					return Response.json({ error: "Unknown operation." }, { status: 400, headers: responseHeaders });
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
