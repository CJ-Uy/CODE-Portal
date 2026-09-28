import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { notifications } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { createNotificationsRepository, notify } from "./notifications";

const actor: Actor = { memberId: "mem_nf", roles: ["member"] };

vi.mock("@/server/features", () => ({ isFeatureEnabled: vi.fn(() => true) }));

async function seedMember() {
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_nf", "nf@example.com", "Notif Member", "active")
		.run();
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin", "active")
		.run();
}

describe("notifications repository on D1", () => {
	beforeEach(async () => {
		vi.mocked(isFeatureEnabled).mockReturnValue(true);
		for (const table of ["notifications", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await seedMember();
	});

	it("materializes a notification via notify() and lists it newest-first", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "Points added", body: "5 points" });
		await notify(db, { memberId: "mem_nf", kind: "event_approved", title: "Approved", body: "Your event is live." });
		const repository = createNotificationsRepository(db);

		const feed = await repository.listFeed(actor, { limit: 20 });

		expect(feed.map((item) => item.kind)).toEqual(["event_approved", "points_awarded"]);
		expect(await repository.unreadCount(actor)).toBe(2);
	});

	it("does not store notifications while the feature is disabled", async () => {
		vi.mocked(isFeatureEnabled).mockReturnValue(false);
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "Points added", body: "5 points" });
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	it("only lists the requesting member's own notifications", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_admin", kind: "forum_reply", title: "Reply", body: "Someone replied." });
		const repository = createNotificationsRepository(db);

		expect(await repository.listFeed(actor, { limit: 20 })).toHaveLength(0);
		expect(await repository.unreadCount(actor)).toBe(0);
	});

	it("marks a single notification read", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "survey_assigned", title: "Survey", body: "You were selected." });
		const repository = createNotificationsRepository(db);
		const [created] = await repository.listFeed(actor);

		await repository.markRead(actor, created.id);
		const [row] = await db.select().from(notifications).where(eq(notifications.id, created.id));

		expect(row.readAt).not.toBeNull();
		expect(await repository.unreadCount(actor)).toBe(0);
	});

	it("ignores markRead for a notification owned by another member", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_admin", kind: "forum_reply", title: "Reply", body: "x" });
		const repository = createNotificationsRepository(db);
		const [created] = await db.select().from(notifications).where(eq(notifications.memberId, "mem_admin"));

		await repository.markRead(actor, created.id);
		const [row] = await db.select().from(notifications).where(eq(notifications.id, created.id));

		expect(row.readAt).toBeNull();
	});

	it("markAllRead clears every unread notification for the member", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "A", body: "x" });
		await notify(db, { memberId: "mem_nf", kind: "forum_reply", title: "B", body: "y" });
		const repository = createNotificationsRepository(db);

		await repository.markAllRead(actor);

		expect(await repository.unreadCount(actor)).toBe(0);
	});
});
