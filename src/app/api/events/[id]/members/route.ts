import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
		return proxySharedApiRequest(
			request,
			`/internal/events?op=searchMembers&eventId=${encodeURIComponent(id)}&query=${encodeURIComponent(query)}`,
		);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
	if (!query) return NextResponse.json({ members: [] });
	try {
		const repositories = await getRepositories();
		const members = await repositories.events.searchAttendableMembers(actor, { eventId: id, query, limit: 20 });
		return NextResponse.json({ members });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
