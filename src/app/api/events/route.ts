import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { createEventInputSchema } from "@/db/contract/events";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function GET(request: Request) {
	const config = getAppConfig();
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, "/internal/events");
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const events = await repositories.events.listPublished(actor, { limit: 50 });
		return NextResponse.json({ events });
	} catch {
		return NextResponse.json({ error: "Not authorized." }, { status: 403 });
	}
}

export async function POST(request: Request) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, "/internal/events?op=create");
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const input = createEventInputSchema.parse(await request.json());
		const repositories = await getRepositories();
		const event = await repositories.events.create(actor, input);
		return NextResponse.json({ event }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
