import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "@/db/schema";
import { createNotificationsRepository } from "@/db/repositories/notifications";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type NotificationsInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

const markReadInputSchema = z.object({ action: z.literal("markRead"), id: z.string().min(1) });
const markAllReadInputSchema = z.object({ action: z.literal("markAllRead") });

export function createNotificationsInternalHandlers({
	db,
	deployEnv,
	allowedOrigins = [],
}: NotificationsInternalDependencies) {
	const repository = createNotificationsRepository(db);

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
					const limitParam = url.searchParams.get("limit");
					const [items, unreadCount] = await Promise.all([
						repository.listFeed(actor, limitParam ? { limit: Number(limitParam) } : undefined),
						repository.unreadCount(actor),
					]);
					return Response.json({ items, unreadCount }, { headers: responseHeaders });
				}

				if (request.method === "POST") {
					const body = await request.json();
					if (markAllReadInputSchema.safeParse(body).success) {
						await repository.markAllRead(actor);
						return Response.json({ ok: true }, { headers: responseHeaders });
					}
					const input = markReadInputSchema.parse(body);
					await repository.markRead(actor, input.id);
					return Response.json({ ok: true }, { headers: responseHeaders });
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
