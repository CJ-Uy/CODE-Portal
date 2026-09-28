import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { surveysContract } from "@/db/contract/surveys";
import { createAuditRepository } from "@/db/repositories/audit";
import { createSurveysRepository } from "@/db/repositories/surveys";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type SurveysInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

async function readBody(request: Request) {
	const text = await request.text();
	return text ? JSON.parse(text) : {};
}

export function createSurveysInternalHandlers({ db, deployEnv, allowedOrigins = [] }: SurveysInternalDependencies) {
	const repository = createSurveysRepository(db, createAuditRepository(db));

	return {
		async fetch(request: Request, surveyId?: string): Promise<Response> {
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
				const op = url.searchParams.get("op") ?? (request.method === "POST" ? "create" : surveyId ? "get" : "list");
				const operationDef = surveysContract[op as keyof typeof surveysContract];
				if (!operationDef) return Response.json({ error: "Unknown operation." }, { status: 400, headers: responseHeaders });
				if (operationDef.sharedDev === "deny") {
					return Response.json(
						{ error: "Operation is disabled in shared development." },
						{ status: 403, headers: responseHeaders },
					);
				}

				if (request.method === "GET" && op === "list") {
					const input = surveysContract.list.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					});
					const surveys = await repository.list(actor, input);
					return Response.json(surveysContract.list.output.parse({ surveys }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "get") {
					const input = surveysContract.get.input.parse({ id: surveyId ?? url.searchParams.get("id") });
					const detail = await repository.getById(actor, input.id);
					return Response.json(
						surveysContract.get.output.parse({ survey: detail?.survey ?? null, questions: detail?.questions ?? [] }),
						{ status: detail ? 200 : 404, headers: responseHeaders },
					);
				}

				if (request.method === "GET" && op === "results") {
					const input = surveysContract.results.input.parse({ id: surveyId ?? url.searchParams.get("id") });
					const results = await repository.getResults(actor, input.id);
					return Response.json(surveysContract.results.output.parse({ results }), { headers: responseHeaders });
				}

				if (request.method === "POST" && op === "create") {
					const input = surveysContract.create.input.parse(await readBody(request));
					const survey = await repository.create(actor, input);
					return Response.json(surveysContract.create.output.parse({ survey }), { status: 201, headers: responseHeaders });
				}

				if (request.method === "POST" && op === "sample") {
					const input = surveysContract.sample.input.parse(await readBody(request));
					const result = await repository.sample(actor, input);
					return Response.json(surveysContract.sample.output.parse(result), { headers: responseHeaders });
				}

				if (request.method === "POST" && op === "submit") {
					const input = surveysContract.submit.input.parse(await readBody(request));
					const result = await repository.submitResponse(input);
					return Response.json(surveysContract.submit.output.parse(result), { headers: responseHeaders });
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
