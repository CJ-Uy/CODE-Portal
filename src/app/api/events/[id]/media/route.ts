import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

const bodySchema = z.object({
	r2Key: z.string().min(1).max(512),
	caption: z.string().trim().max(280).nullable().default(null),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=listMedia&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const media = await repositories.eventMedia.listForEvent(actor, id);
		return NextResponse.json({ media });
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
		return proxySharedApiRequest(request, `/internal/events?op=addMedia&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const { r2Key, caption } = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const media = await repositories.eventMedia.add(actor, { eventId: id, r2Key, caption });
		return NextResponse.json({ media }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
