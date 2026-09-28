import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { rateLimitCounters } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

export type RateLimitResult = {
	allowed: boolean;
	remaining: number;
	resetAt: number;
};

export type RateLimitOptions = {
	key: string;
	limit: number;
	windowMs: number;
	now?: number;
};

export async function checkRateLimit(db: Db, options: RateLimitOptions): Promise<RateLimitResult> {
	const now = options.now ?? Date.now();
	const windowStart = now - (now % options.windowMs);
	const resetAt = windowStart + options.windowMs;
	const windowStartDate = new Date(windowStart);

	// ponytail: one fixed window row per key/window, replace with KV or DO only if D1 contention shows up.
	await db
		.insert(rateLimitCounters)
		.values({ bucketKey: options.key, windowStart: windowStartDate, count: 1, updatedAt: new Date(now) })
		.onConflictDoUpdate({
			target: [rateLimitCounters.bucketKey, rateLimitCounters.windowStart],
			set: { count: sql`${rateLimitCounters.count} + 1`, updatedAt: new Date(now) },
		});

	const [row] = await db
		.select()
		.from(rateLimitCounters)
		.where(and(eq(rateLimitCounters.bucketKey, options.key), eq(rateLimitCounters.windowStart, windowStartDate)))
		.limit(1);

	const count = row?.count ?? 1;
	return {
		allowed: count <= options.limit,
		remaining: Math.max(0, options.limit - count),
		resetAt,
	};
}
