import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventForumRepository } from "./event-forum";

const author: Actor = { memberId: "mem_a", roles: ["member"] };
const reader: Actor = { memberId: "mem_b", roles: ["member"] };
const superAdmin: Actor = { memberId: "mem_super", roles: ["super"] };
const START = new Date("2026-07-10T10:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createEventForumRepository(db, createAuditRepository(db)) };
}

describe("event forum repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_forum_posts", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const [id, email, name] of [
			["mem_a", "a@example.com", "Author A"],
			["mem_b", "b@example.com", "Reader B"],
			["mem_super", "s@example.com", "Super"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
				.bind(id, email, name, name)
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "E", "official", "approved", "x", START.getTime(), "d", "mem_a", "")
			.run();
	});

	it("hides the author of an anonymous post from a normal reader", async () => {
		const { repo } = makeRepo();
		await repo.post(author, { eventId: "evt_1", body: "secret take", anonymous: true, parentId: null });
		const [post] = await repo.listForEvent(reader, "evt_1");
		expect(post.anonymous).toBe(true);
		expect(post.author).toBeNull();
	});

	it("shows the author of a non-anonymous post", async () => {
		const { repo } = makeRepo();
		await repo.post(author, { eventId: "evt_1", body: "open take", anonymous: false, parentId: null });
		const [post] = await repo.listForEvent(reader, "evt_1");
		expect(post.author?.memberId).toBe("mem_a");
	});

	it("lets a super admin see and reveal an anonymous author with an audit row", async () => {
		const { db, repo } = makeRepo();
		const created = await repo.post(author, { eventId: "evt_1", body: "secret", anonymous: true, parentId: null });
		const [seen] = await repo.listForEvent(superAdmin, "evt_1");
		expect(seen.author?.memberId).toBe("mem_a");
		const revealed = await repo.revealAuthor(superAdmin, created.id);
		expect(revealed.memberId).toBe("mem_a");
		const [audit] = await db.select().from(schema.auditLogs);
		expect(audit).toMatchObject({ action: "forum:reveal_author", category: "event" });
	});

	it("denies a normal admin from revealing an anonymous author", async () => {
		const { repo } = makeRepo();
		const created = await repo.post(author, { eventId: "evt_1", body: "secret", anonymous: true, parentId: null });
		await expect(repo.revealAuthor(reader, created.id)).rejects.toThrow("Not authorized");
	});
});
