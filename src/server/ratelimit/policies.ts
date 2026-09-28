import type { RateLimitResult } from "./limiter";

export const RATE_LIMITS = {
	authSignin: { limit: 10, windowMs: 60_000 },
	linkCreate: { limit: 20, windowMs: 60_000 },
	scanSubmit: { limit: 120, windowMs: 60_000 },
	contactSubmit: { limit: 5, windowMs: 600_000 },
	feedbackSubmit: { limit: 3, windowMs: 600_000 },
} as const;

export function clientIpFromRequest(request: Request): string {
	const cfIp = request.headers.get("cf-connecting-ip");
	if (cfIp) return cfIp.trim();

	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}

	return "unknown";
}

export function tooManyRequests(result: RateLimitResult): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
	return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
		status: 429,
		headers: {
			"content-type": "application/json",
			"retry-after": String(retryAfterSeconds),
		},
	});
}
