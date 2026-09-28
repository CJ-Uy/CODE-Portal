import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

const bodySchema = z.object({
	body: z.string().trim().min(1).max(4000),
	anonymous: z.boolean().default(false),
	parentId: z.string().min(1).nullable().default(null),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=listForumPosts&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const posts = await repositories.eventForum.listForEvent(actor, id);
		return NextResponse.json({ posts });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=post&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const input = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const post = await repositories.eventForum.post(actor, { eventId: id, ...input });
		return NextResponse.json({ post }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
