import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { crsEvents } from "@/db/schema";
import { uploadsContract } from "@/db/contract/uploads";
import { createAuditRepository } from "@/db/repositories/audit";
import { createLinksRepository } from "@/db/repositories/links";
import type { DeployEnv } from "@/server/env";
import type { StorageAdapter } from "@/storage/types";
import { createUploadHandlers } from "@/server/uploads";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type UploadsInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	storage: StorageAdapter;
	allowedOrigins?: string[];
};

export function createUploadsInternalHandlers({
	db,
	deployEnv,
	storage,
	allowedOrigins = [],
}: UploadsInternalDependencies) {
	const linksRepository = createLinksRepository(db, createAuditRepository(db));
	const uploads = createUploadHandlers({
		getActor: (request) => resolveSharedActor(db, request),
		storage,
		canPostEvent: async (_actor, eventId) => {
			const [event] = await db
				.select({ id: crsEvents.id })
				.from(crsEvents)
				.where(and(eq(crsEvents.id, eventId), isNull(crsEvents.deletedAt)))
				.limit(1);
			return Boolean(event);
		},
		canEditLink: async (actor, linkId) => {
			return linksRepository.canEditLink(actor, linkId);
		},
	});

	return {
		async collection(request: Request): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			return withCors(request, allowedOrigins, async () => {
				if (request.method === "POST" && uploadsContract.put.sharedDev === "deny") {
					const actor = await resolveSharedActor(db, request);
					if (!actor) return Response.json({ error: "Invalid shared development token." }, { status: 401 });
					return Response.json({ error: "Operation is disabled in shared development." }, { status: 403 });
				}
				return uploads.collection(request);
			});
		},
		async object(request: Request, key: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			return withCors(request, allowedOrigins, async () => {
				if (request.method === "DELETE" && uploadsContract.delete.sharedDev === "deny") {
					const actor = await resolveSharedActor(db, request);
					if (!actor) {
						return Response.json(
							{ error: "Invalid shared development token." },
							{ status: 401 },
						);
					}
					return Response.json(
						{ error: "Operation is disabled in shared development." },
						{ status: 403 },
					);
				}
				return uploads.object(request, key);
			});
		},
	};
}

async function withCors(
	request: Request,
	allowedOrigins: string[],
	handler: () => Promise<Response>,
): Promise<Response> {
	const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
	if (request.method === "OPTIONS") {
		return new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined });
	}
	if (request.headers.has("origin") && !corsHeaders) {
		return Response.json({ error: "Origin is not allowed." }, { status: 403 });
	}

	const response = await handler();
	for (const [name, value] of corsHeaders ?? []) response.headers.set(name, value);
	return response;
}
