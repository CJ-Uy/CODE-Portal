import type { DrizzleD1Database } from "drizzle-orm/d1";
import { ZodError } from "zod";
import type * as schema from "@/db/schema";
import { mentsContract } from "@/db/contract/ments";
import { createAuditRepository } from "@/db/repositories/audit";
import { createMentsRepository } from "@/db/repositories/ments";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

export function createMentsInternalHandlers({ db, deployEnv, enabled, allowedOrigins = [] }: {
	db: DrizzleD1Database<typeof schema>; deployEnv: string; enabled: boolean; allowedOrigins?: string[];
}) {
	const repository = createMentsRepository(db, createAuditRepository(db));
	return {
		async fetch(request: Request): Promise<Response> {
			if (deployEnv !== "dev" || !enabled) return new Response("Not found", { status: 404 });
			const headers = getInternalCorsHeaders(request, allowedOrigins);
			if (request.method === "OPTIONS") return new Response(null, { status: headers ? 204 : 403, headers: headers ?? undefined });
			if (request.headers.has("origin") && !headers) return Response.json({ error: "Origin is not allowed." }, { status: 403 });
			const actor = await resolveSharedActor(db, request);
			if (!actor) return Response.json({ error: "Invalid shared development token." }, { status: 401, headers: headers ?? undefined });
			try {
				let result;
				if (request.method === "GET") {
					const manage = new URL(request.url).searchParams.get("manage") === "1";
					result = manage
						? mentsContract.manage.output.parse({ people: await repository.manage(actor) })
						: mentsContract.list.output.parse({ people: await repository.list(actor) });
				} else if (request.method === "POST") {
					result = mentsContract.save.output.parse({ person: await repository.save(actor, mentsContract.save.input.parse(await request.json())) });
				} else if (request.method === "PUT") {
					const { raw } = mentsContract.import.input.parse(await request.json());
					result = mentsContract.import.output.parse(await repository.import(actor, raw));
				} else if (request.method === "DELETE") {
					const { id } = mentsContract.remove.input.parse(await request.json());
					await repository.remove(actor, id);
					result = { ok: true };
				} else return new Response("Method not allowed", { status: 405, headers: headers ?? undefined });
				return Response.json(result, { headers: headers ?? undefined });
			} catch (error) {
				const message = error instanceof ZodError ? error.issues[0]?.message ?? "Invalid ments input." : error instanceof Error && !error.cause ? error.message : "The ments request failed.";
				return Response.json({ error: message }, { status: message.startsWith("Not authorized") ? 403 : 400, headers: headers ?? undefined });
			}
		},
	};
}
