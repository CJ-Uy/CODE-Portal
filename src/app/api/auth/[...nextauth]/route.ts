import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { getDb } from "@/db/client";
import { checkRateLimit } from "@/server/ratelimit/limiter";
import { clientIpFromRequest, RATE_LIMITS, tooManyRequests } from "@/server/ratelimit/policies";

export const GET = handlers.GET;

export async function POST(request: NextRequest): Promise<Response> {
	const ip = clientIpFromRequest(request);

	try {
		const result = await checkRateLimit(getDb(), { key: `auth:signin:${ip}`, ...RATE_LIMITS.authSignin });
		if (!result.allowed) return tooManyRequests(result);
	} catch {
		// ponytail: fail open so limiter storage cannot block sign-in.
	}

	return handlers.POST(request);
}
