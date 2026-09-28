import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { enforceRateLimit } from "@/server/ratelimit/guard";
import { clientIpFromRequest, RATE_LIMITS } from "@/server/ratelimit/policies";
import { isFeatureEnabled } from "@/server/features";

const bodySchema = z.object({
	name: z.string().trim().min(1).max(120),
	organization: z.string().trim().min(1).max(160),
	email: z.string().trim().email().max(200),
	orgSegment: z.enum(["within_ls", "outside_ls", "not_sure"]),
	message: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
	if (!isFeatureEnabled("publicSite")) return new Response(null, { status: 404 });
	const ip = clientIpFromRequest(request);
	try {
		const { getDb } = await import("@/db/client");
		const limited = await enforceRateLimit(getDb(), "contact", ip, RATE_LIMITS.contactSubmit);
		if (limited) return limited;
	} catch {
		// ponytail: fail open on rate-limit infra errors, the insert below still caps via zod.
	}
	try {
		const body = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		await repositories.submissions.createContact(body);
		return NextResponse.json({ ok: true });
	} catch (error) {
		const message = error instanceof z.ZodError ? "Please check the form and try again." : "Could not send your message.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
