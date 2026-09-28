import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { postId } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=revealAuthor&postId=${encodeURIComponent(postId)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const author = await repositories.eventForum.revealAuthor(actor, postId);
		return NextResponse.json({ author });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
