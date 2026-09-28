import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { linksContract, linkStatsInputFromUrl, searchLinksInputFromUrl } from "@/db/contract/links";
import { createAuditRepository } from "@/db/repositories/audit";
import { createLinksRepository, linkErrorStatus } from "@/db/repositories/links";
import type { DeployEnv } from "@/server/env";
import { buildRedirectResponse } from "@/server/links/redirect";
import { z } from "zod";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type LinksInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

type GuardResult = {
	headers: Headers | undefined;
	actor: Awaited<ReturnType<typeof resolveSharedActor>>;
	early?: Response;
};

export function createLinksInternalHandlers({ db, deployEnv, allowedOrigins = [] }: LinksInternalDependencies) {
	const repository = createLinksRepository(db, createAuditRepository(db));

	async function guard(request: Request): Promise<GuardResult> {
		const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
		if (request.method === "OPTIONS") {
			return { headers: undefined, actor: null, early: new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined }) };
		}
		if (request.headers.has("origin") && !corsHeaders) {
			return { headers: undefined, actor: null, early: Response.json({ error: "Origin is not allowed." }, { status: 403 }) };
		}
		const headers = corsHeaders ?? undefined;
		const actor = await resolveSharedActor(db, request);
		if (!actor) {
			return { headers, actor: null, early: Response.json({ error: "Invalid shared development token." }, { status: 401, headers }) };
		}
		return { headers, actor };
	}

	function deny(headers: Headers | undefined): Response {
		return Response.json({ error: "Operation is disabled in shared development." }, { status: 403, headers });
	}

	function fail(error: unknown, headers: Headers | undefined): Response {
		const message = error instanceof z.ZodError
			? error.issues[0]?.message ?? "Internal request failed."
			: error instanceof Error ? error.message : "Internal request failed.";
		return Response.json({ error: message }, { status: linkErrorStatus(error), headers });
	}

	return {
		async collection(request: Request): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			try {
				if (request.method === "GET") {
					const url = new URL(request.url);
					const scope = url.searchParams.get("scope");
					if (scope === "search") return Response.json(await repository.searchVisible(actor, searchLinksInputFromUrl(url)), { headers });
					const op = scope === "all" ? linksContract.listAll : scope === "own" ? linksContract.listOwn : linksContract.listVisible;
					const input = op.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
						offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
					});
					const links = scope === "all" ? await repository.listAll(actor, input) : scope === "own" ? await repository.listOwn(actor, input) : await repository.listVisible(actor, input);
					return Response.json({ links }, { headers });
				}
				if (request.method === "POST") {
					if (linksContract.create.sharedDev === "deny") return deny(headers);
					const input = linksContract.create.input.parse(await request.json());
					const link = await repository.create(actor, input);
					return Response.json({ link }, { status: 201, headers });
				}
				return new Response("Method not allowed", { status: 405, headers });
			} catch (error) {
				return fail(error, headers);
			}
		},

		async item(request: Request, id: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			try {
				if (request.method === "GET") {
					const link = await repository.getById(actor, id);
					return Response.json({ link }, { status: link ? 200 : 404, headers });
				}
				if (request.method === "PATCH") {
					if (linksContract.update.sharedDev === "deny") return deny(headers);
					const body = await request.json();
					const input = linksContract.update.input.parse({ ...(body && typeof body === "object" ? body : {}), id });
					const { id: parsedId, ...patch } = input;
					void parsedId;
					const link = await repository.update(actor, id, patch);
					return Response.json({ link }, { headers });
				}
				if (request.method === "DELETE") {
					if (linksContract.remove.sharedDev === "deny") return deny(headers);
					await repository.remove(actor, id);
					return new Response(null, { status: 204, headers });
				}
				return new Response("Method not allowed", { status: 405, headers });
			} catch (error) {
				return fail(error, headers);
			}
		},

		async stats(request: Request, id: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
			try {
				const { id: parsedId, ...query } = linkStatsInputFromUrl(request, id);
				void parsedId;
				return Response.json(await repository.getStats(actor, id, query), { headers });
			} catch (error) {
				return fail(error, headers);
			}
		},

		async redirect(request: Request, slug: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { early } = await guard(request);
			if (early) return early;
			const url = new URL(request.url);
			let background: Promise<unknown> = Promise.resolve();
			const response = await buildRedirectResponse(
				{
					resolveForRedirect: (value) => repository.resolveForRedirect(value),
					recordClick: (linkId, input) => repository.recordClick(linkId, input),
					scheduleBackground: (task) => {
						background = task;
					},
					previewImageBaseUrl: url.origin,
				},
				request,
				slug,
			);
			await background;
			return response;
		},
	};
}
