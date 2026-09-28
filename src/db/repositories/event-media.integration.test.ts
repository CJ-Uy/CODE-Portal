import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventMediaRepository } from "./event-media";

const member: Actor = { memberId: "mem_a", roles: ["member"] };
const eventsAdmin: Actor = { memberId: "mem_a", roles: ["events"] };
const START = new Date("2026-07-10T10:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createEventMediaRepository(db, createAuditRepository(db)) };
}

describe("event media repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_media", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_a", "a@example.com", "A")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "E", "official", "approved", "x", START.getTime(), "d", "mem_a", "")
			.run();
	});

	it("records and lists media for a visible event", async () => {
		const { repo } = makeRepo();
		const created = await repo.add(eventsAdmin, {
			eventId: "evt_1",
			r2Key: "events/evt_1/mem_a/media_x.png",
			caption: "Group photo",
		});
		expect(created.r2Key).toBe("events/evt_1/mem_a/media_x.png");
		const listed = await repo.listForEvent(member, "evt_1");
		expect(listed.map((row) => row.id)).toContain(created.id);
	});

	it("denies a plain member from adding event media", async () => {
		const { repo } = makeRepo();
		await expect(repo.add(member, { eventId: "evt_1", r2Key: "k", caption: null })).rejects.toThrow("Not authorized");
	});

	it("rejects recording media for a non-existent or deleted event", async () => {
		const { repo } = makeRepo();
		await expect(repo.add(eventsAdmin, { eventId: "missing", r2Key: "events/missing/x.png", caption: null })).rejects.toThrow();
		await env.DB.prepare("UPDATE crs_events SET deleted_at = ? WHERE id = ?").bind(Date.now(), "evt_1").run();
		await expect(repo.add(eventsAdmin, { eventId: "evt_1", r2Key: "events/evt_1/x.png", caption: null })).rejects.toThrow();
	});
});
