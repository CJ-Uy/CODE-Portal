import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { retentionContract } from "@/db/contract/retention";
import { createAuditRepository } from "@/db/repositories/audit";
import { createRetentionRepository } from "@/db/repositories/retention";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type RetentionInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createRetentionInternalHandlers({ db, deployEnv, allowedOrigins = [] }: RetentionInternalDependencies) {
	const repository = createRetentionRepository(db, createAuditRepository(db));

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
					if (url.searchParams.get("terms")) {
						const terms = await repository.listTerms(actor);
						const output = retentionContract.myTerms.output.parse({ terms });
						return Response.json(output, { headers: responseHeaders });
					}
					if (url.searchParams.get("report") === "term") {
						const input = retentionContract.reportTerm.input.parse({ termId: url.searchParams.get("termId") });
						const rows = await repository.listForTerm(actor, input.termId);
						const output = retentionContract.reportTerm.output.parse({ rows });
						return Response.json(output, { headers: responseHeaders });
					}
					if (url.searchParams.get("report") === "member") {
						const input = retentionContract.reportMember.input.parse({
							memberId: url.searchParams.get("memberId"),
							termId: url.searchParams.get("termId"),
						});
						const rows = await repository.listMemberTermHistory(actor, input.memberId, input.termId);
						const output = retentionContract.reportMember.output.parse({ rows });
						return Response.json(output, { headers: responseHeaders });
					}
					if (url.searchParams.get("report") === "event") {
						const input = retentionContract.reportEvent.input.parse({ eventId: url.searchParams.get("eventId") });
						const rows = await repository.listForEvent(actor, input.eventId);
						const output = retentionContract.reportEvent.output.parse({ rows });
						return Response.json(output, { headers: responseHeaders });
					}
					const input = retentionContract.myHistory.input.parse({
						termId: url.searchParams.get("termId") ?? undefined,
					});
					const result = await repository.myHistory(actor, input);
					const output = retentionContract.myHistory.output.parse(result);
					return Response.json(output, { headers: responseHeaders });
				}

				if (request.method === "POST") {
					if (retentionContract.createManual.sharedDev === "deny") {
						return Response.json(
							{ error: "Operation is disabled in shared development." },
							{ status: 403, headers: responseHeaders },
						);
					}
					const input = retentionContract.createManual.input.parse(await request.json());
					const result = await repository.createManual(actor, input);
					const output = retentionContract.createManual.output.parse(result);
					return Response.json(output, { status: 201, headers: responseHeaders });
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
