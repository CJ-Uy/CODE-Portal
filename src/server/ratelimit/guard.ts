import type { getDb } from "@/db/client";
import { checkRateLimit } from "./limiter";
import { tooManyRequests } from "./policies";

type Db = ReturnType<typeof getDb>;
type Policy = { limit: number; windowMs: number };

export async function enforceRateLimit(
	db: Db,
	policyKey: string,
	subject: string,
	policy: Policy,
): Promise<Response | null> {
	try {
		const result = await checkRateLimit(db, { key: `${policyKey}:${subject}`, ...policy });
		return result.allowed ? null : tooManyRequests(result);
	} catch {
		// ponytail: fail open because rate limiting is a hardening layer, not core availability.
		return null;
	}
}
