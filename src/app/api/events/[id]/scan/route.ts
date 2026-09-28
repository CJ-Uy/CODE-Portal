import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { verifyCheckinToken } from "@/lib/checkin-token";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { enforceRateLimit } from "@/server/ratelimit/guard";
import { RATE_LIMITS } from "@/server/ratelimit/policies";
import { proxySharedApiRequest } from "@/server/shared-api";

// Accept either the long-lived static member code (memberId, today's flow) or a
// short-lived signed event check-in token. termId is always required.
const bodySchema = z
	.object({ memberId: z.string().min(1).optional(), token: z.string().min(1).optional(), termId: z.string().min(1) })
	.refine((body) => Boolean(body.memberId) || Boolean(body.token), {
		message: "Provide a member code or a check-in token.",
	});

const undoBodySchema = z.object({ memberId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=scan&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const { getDb } = await import("@/db/client");
		const limited = await enforceRateLimit(getDb(), "scan:submit", actor.memberId, RATE_LIMITS.scanSubmit);
		if (limited) return limited;
	} catch {
		// ponytail: include getDb failure in fail-open path for tests and degraded local DB.
	}
	try {
		const body = bodySchema.parse(await request.json());
		let memberId = body.memberId ?? null;
		if (body.token) {
			if (!config.AUTH_SECRET) {
				return NextResponse.json({ error: "Check-in tokens are not available in this environment." }, { status: 400 });
			}
			const verified = await verifyCheckinToken(config.AUTH_SECRET, body.token, id);
			if (!verified) {
				return NextResponse.json({ error: "Check-in code is invalid or expired." }, { status: 400 });
			}
			memberId = verified.memberId;
		}
		if (!memberId) {
			return NextResponse.json({ error: "Provide a member code or a check-in token." }, { status: 400 });
		}
		const repositories = await getRepositories();
		const result = await repositories.events.recordScan(actor, { eventId: id, memberId, termId: body.termId });
		return NextResponse.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=undoScan&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const { getDb } = await import("@/db/client");
		const limited = await enforceRateLimit(getDb(), "scan:undo", actor.memberId, RATE_LIMITS.scanSubmit);
		if (limited) return limited;
	} catch {
		// ponytail: include getDb failure in fail-open path for tests and degraded local DB.
	}
	try {
		const body = undoBodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const result = await repositories.events.undoScan(actor, { eventId: id, memberId: body.memberId });
		return NextResponse.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
