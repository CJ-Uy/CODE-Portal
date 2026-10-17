import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { RATE_LIMITS } from "@/server/ratelimit/policies";

const member: Actor = { memberId: "mem_reader", roles: ["member"] };

const getActor = vi.fn();
const isFeatureEnabled = vi.fn();
const enforceRateLimit = vi.fn();
const record = vi.fn();
const appEnv = { value: "production" };
const fakeDb = {};

vi.mock("@/server/auth/actor", () => ({ getActor: () => getActor() }));
vi.mock("@/server/env", () => ({ getAppConfig: () => ({ APP_ENV: appEnv.value, APP_BASE_URL: "https://app.test" }) }));
vi.mock("@/server/features", () => ({ isFeatureEnabled: (key: string) => isFeatureEnabled(key) }));
vi.mock("@/server/ratelimit/guard", () => ({ enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args) }));
vi.mock("@/db/client", () => ({ getDb: () => fakeDb }));
vi.mock("@/db", () => ({ getRepositories: async () => ({ libraryActivity: { record } }) }));

import { POST } from "./route";

function ping(body: unknown, headers: Record<string, string> = { origin: "https://app.test" }) {
	const request = new Request("https://app.test/api/library/lib_1/activity", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
	return POST(request, { params: Promise.resolve({ id: "lib_1" }) });
}

describe("POST /api/library/[id]/activity", () => {
	beforeEach(() => {
		appEnv.value = "production";
		getActor.mockReset().mockResolvedValue(member);
		isFeatureEnabled.mockReset().mockReturnValue(true);
		enforceRateLimit.mockReset().mockResolvedValue(null);
		record.mockReset().mockResolvedValue(undefined);
	});

	it("records the ping and answers 204", async () => {
		const response = await ping({ kind: "active", seconds: 15 });
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(record).toHaveBeenCalledWith(member, "lib_1", { kind: "active", seconds: 15 });
		expect(isFeatureEnabled).toHaveBeenCalledWith("library");
	});

	it("accepts an open or download ping with no seconds", async () => {
		expect((await ping({ kind: "open" })).status).toBe(204);
		expect((await ping({ kind: "download" })).status).toBe(204);
		expect(record).toHaveBeenCalledTimes(2);
	});

	it("rejects a cross-origin or originless request before doing anything", async () => {
		expect((await ping({ kind: "open" }, { origin: "https://evil.test" })).status).toBe(403);
		expect((await ping({ kind: "open" }, {})).status).toBe(403);
		expect(getActor).not.toHaveBeenCalled();
		expect(record).not.toHaveBeenCalled();
	});

	it("answers 404 when the library feature is off", async () => {
		isFeatureEnabled.mockReturnValue(false);
		expect((await ping({ kind: "open" })).status).toBe(404);
		expect(record).not.toHaveBeenCalled();
	});

	it("answers 404 in shared dev mode, where the library has no internal API", async () => {
		appEnv.value = "shared";
		expect((await ping({ kind: "open" })).status).toBe(404);
		expect(record).not.toHaveBeenCalled();
	});

	it("answers 401 without an actor", async () => {
		getActor.mockResolvedValue(null);
		expect((await ping({ kind: "open" })).status).toBe(401);
		expect(record).not.toHaveBeenCalled();
	});

	it("rate limits per member with the libraryActivity policy", async () => {
		expect(RATE_LIMITS.libraryActivity).toEqual({ limit: 20, windowMs: 60_000 });
		await ping({ kind: "open" });
		expect(enforceRateLimit).toHaveBeenCalledWith(fakeDb, "libraryActivity", "mem_reader", RATE_LIMITS.libraryActivity);
		enforceRateLimit.mockResolvedValue(new Response(null, { status: 429 }));
		expect((await ping({ kind: "open" })).status).toBe(429);
		expect(record).toHaveBeenCalledTimes(1);
	});

	it("answers 400 for a bad body", async () => {
		for (const body of [
			"not json",
			"null",
			{},
			{ kind: "bogus" },
			{ kind: "active", seconds: -1 },
			{ kind: "active", seconds: 601 },
			{ kind: "active", seconds: 1.5 },
			{ kind: "active", seconds: "30" },
		]) {
			expect((await ping(body)).status, JSON.stringify(body)).toBe(400);
		}
		expect(record).not.toHaveBeenCalled();
	});

	it("accepts the seconds bounds", async () => {
		expect((await ping({ kind: "active", seconds: 0 })).status).toBe(204);
		expect((await ping({ kind: "active", seconds: 600 })).status).toBe(204);
	});
});
