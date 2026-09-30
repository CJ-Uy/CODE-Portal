import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getArticle } from "@/content/site";
import { enforceRateLimit } from "@/server/ratelimit/guard";
import { clientIpFromRequest, RATE_LIMITS } from "@/server/ratelimit/policies";
import { isFeatureEnabled } from "@/server/features";

const bodySchema = z.object({
	rating: z.number().int().min(1).max(5),
	comment: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	if (!isFeatureEnabled("publicSite")) return new Response(null, { status: 404 });
	const { slug } = await params;
	if (!getArticle(slug)) {
		return NextResponse.json({ error: "Unknown article." }, { status: 404 });
	}
	const ip = clientIpFromRequest(request);
	try {
		const { getDb } = await import("@/db/client");
		const limited = await enforceRateLimit(getDb(), "feedback", `${ip}:${slug}`, RATE_LIMITS.feedbackSubmit);
		if (limited) return limited;
	} catch {
		// ponytail: fail open on rate-limit infra errors.
	}
	try {
		const body = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		await repositories.submissions.createFeedback({ articleSlug: slug, rating: body.rating, comment: body.comment ?? null });
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Could not record your feedback." }, { status: 400 });
	}
}
