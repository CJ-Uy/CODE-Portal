import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=listAttendance&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const attendance = await repositories.events.listAttendance(actor, id);
		return NextResponse.json({ attendance });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
