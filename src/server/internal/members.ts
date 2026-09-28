import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { membersContract } from "@/db/contract/members";
import { createAuditRepository } from "@/db/repositories/audit";
import { createMembersRepository } from "@/db/repositories/members";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type MembersInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createMembersInternalHandlers({
	db,
	deployEnv,
	allowedOrigins = [],
}: MembersInternalDependencies) {
	const repository = createMembersRepository(db, createAuditRepository(db));

	return {
		async fetch(request: Request, memberId?: string): Promise<Response> {
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
					if (memberId) {
						const input = membersContract.get.input.parse({ id: memberId });
						const member = await repository.getById(actor, input.id);
						const output = membersContract.get.output.parse({ member });
						return Response.json(output, { status: member ? 200 : 404, headers: responseHeaders });
					}
					const url = new URL(request.url);
					const input = membersContract.list.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					});
					const members = await repository.list(actor, input);
					const output = membersContract.list.output.parse({ members });
					return Response.json(output, { headers: responseHeaders });
				}

				if (request.method === "POST") {
					if (membersContract.create.sharedDev === "deny") {
						return Response.json(
							{ error: "Operation is disabled in shared development." },
							{ status: 403, headers: responseHeaders },
						);
					}
					const input = membersContract.create.input.parse(await request.json());
					const member = await repository.create(actor, input);
					const output = membersContract.create.output.parse({ member });
					return Response.json(output, { status: 201, headers: responseHeaders });
				}

				if (request.method === "PATCH") {
					const input = membersContract.updateProfile.input.parse(await request.json());
					const member = await repository.updateProfile(actor, actor.memberId, input);
					const output = membersContract.updateProfile.output.parse({ member });
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
