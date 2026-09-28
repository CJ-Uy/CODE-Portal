import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { checkRateLimit } from "./limiter";

const WINDOW_MS = 60_000;
const NOW = new Date("2026-06-19T00:00:00.000Z").getTime();

describe("checkRateLimit", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM rate_limit_counters").run();
	});

	it("allows requests up to the limit within one window", async () => {
		const db = drizzle(env.DB, { schema });
		const opts = { key: "auth:signin:1.2.3.4", limit: 3, windowMs: WINDOW_MS, now: NOW };

		const first = await checkRateLimit(db, opts);
		const second = await checkRateLimit(db, opts);
		const third = await checkRateLimit(db, opts);

		expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
		expect(third.remaining).toBe(0);
	});

	it("blocks the request that exceeds the limit", async () => {
		const db = drizzle(env.DB, { schema });
		const opts = { key: "auth:signin:1.2.3.4", limit: 2, windowMs: WINDOW_MS, now: NOW };

		await checkRateLimit(db, opts);
		await checkRateLimit(db, opts);
		const blocked = await checkRateLimit(db, opts);

		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(0);
		expect(blocked.resetAt).toBe(NOW + WINDOW_MS);
	});

	it("resets the count in a new window", async () => {
		const db = drizzle(env.DB, { schema });
		const base = { key: "link:create:mem_1", limit: 1, windowMs: WINDOW_MS };

		const firstWindow = await checkRateLimit(db, { ...base, now: NOW });
		const blocked = await checkRateLimit(db, { ...base, now: NOW + 1 });
		const nextWindow = await checkRateLimit(db, { ...base, now: NOW + WINDOW_MS });

		expect(firstWindow.allowed).toBe(true);
		expect(blocked.allowed).toBe(false);
		expect(nextWindow.allowed).toBe(true);
	});

	it("isolates counts per key", async () => {
		const db = drizzle(env.DB, { schema });
		const base = { limit: 1, windowMs: WINDOW_MS, now: NOW };

		const a = await checkRateLimit(db, { ...base, key: "scan:submit:mem_a" });
		const b = await checkRateLimit(db, { ...base, key: "scan:submit:mem_b" });

		expect(a.allowed).toBe(true);
		expect(b.allowed).toBe(true);
	});
});
