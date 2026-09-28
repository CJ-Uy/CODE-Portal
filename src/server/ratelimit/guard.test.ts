import { afterEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/db/client";
import { enforceRateLimit } from "./guard";
import * as limiter from "./limiter";
import { RATE_LIMITS } from "./policies";

const fakeDb = {} as ReturnType<typeof getDb>;

describe("enforceRateLimit", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null when the limiter allows the request", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 1000 });
		const result = await enforceRateLimit(fakeDb, "link:create", "mem_1", RATE_LIMITS.linkCreate);
		expect(result).toBeNull();
	});

	it("returns a 429 response when the limiter blocks the request", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });
		const result = await enforceRateLimit(fakeDb, "link:create", "mem_1", RATE_LIMITS.linkCreate);
		expect(result?.status).toBe(429);
	});

	it("fails open and returns null when the limiter throws", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockRejectedValue(new Error("d1 down"));
		const result = await enforceRateLimit(fakeDb, "scan:submit", "mem_1", RATE_LIMITS.scanSubmit);
		expect(result).toBeNull();
	});
});
