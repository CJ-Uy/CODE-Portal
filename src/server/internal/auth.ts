import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { authContract } from "@/db/contract/auth";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type AuthInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createAuthInternalHandlers({ db, deployEnv, allowedOrigins = [] }: AuthInternalDependencies) {
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
			if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

			const actor = await resolveSharedActor(db, request);
			if (!actor) {
				return Response.json({ error: "Invalid shared development token." }, { status: 401, headers: corsHeaders ?? undefined });
			}

			return Response.json(
				authContract.actor.output.parse({
					actor: {
						memberId: actor.memberId,
						roles: actor.roles,
						context: actor.context,
						sharedTokenLabel: actor.sharedTokenLabel,
					},
				}),
				{ headers: corsHeaders ?? undefined },
			);
		},
	};
}
