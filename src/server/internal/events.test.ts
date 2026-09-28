import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createEventsInternalHandlers } from "./events";
import { hashSharedToken } from "./shared-actor";

function handlers(deployEnv: "dev" | "prod" = "dev") {
	const db = drizzle(env.DB, { schema });
	return createEventsInternalHandlers({ db, deployEnv, allowedOrigins: [] });
}

describe("events internal handlers", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM event_forum_posts").run();
		await env.DB.prepare("DELETE FROM event_media").run();
		await env.DB.prepare("DELETE FROM crs_attendance").run();
		await env.DB.prepare("DELETE FROM event_rsvps").run();
		await env.DB.prepare("DELETE FROM crs_events").run();
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM shared_dev_tokens").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM roles").run();
		await env.DB.prepare("DELETE FROM members").run();
	});

	it("returns 404 when the deploy env is not dev", async () => {
		const response = await handlers("prod").fetch(new Request("https://dev.example/internal/events"));
		expect(response.status).toBe(404);
	});

	it("rejects a request with no shared token", async () => {
		const response = await handlers().fetch(new Request("https://dev.example/internal/events"));
		expect(response.status).toBe(401);
	});

	it("refuses a sharedDev:deny op (create) even with a valid admin token", async () => {
		const token = "test-token";
		const tokenHash = await hashSharedToken(token);
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin")
			.run();
		await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
			.bind("role_retention", "retention", "Retention", "Retention", "system")
			.run();
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_by) VALUES (?, ?, ?)")
			.bind("mem_admin", "role_retention", "mem_admin")
			.run();
		await env.DB.prepare("INSERT INTO shared_dev_tokens (token_hash, member_id, label) VALUES (?, ?, ?)")
			.bind(tokenHash, "mem_admin", "admin")
			.run();

		const response = await handlers().fetch(
			new Request("https://dev.example/internal/events?op=create", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({}),
			}),
		);
		expect(response.status).toBe(403);
	});

	it("lists forum posts for a valid shared member token", async () => {
		const token = "member-token";
		const tokenHash = await hashSharedToken(token);
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_author", "author@example.com", "Author", "Author A")
			.run();
		await env.DB.prepare("INSERT INTO shared_dev_tokens (token_hash, member_id, label) VALUES (?, ?, ?)")
			.bind(tokenHash, "mem_author", "member")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "Practice", "official", "approved", "SOM 111", Date.parse("2026-07-10T10:00:00.000Z"), "Practice", "mem_author", "")
			.run();
		await env.DB.prepare(
			"INSERT INTO event_forum_posts (id, event_id, member_id, anonymous, body) VALUES (?, ?, ?, ?, ?)",
		)
			.bind("post_1", "evt_1", "mem_author", 1, "Can I bring snacks?")
			.run();

		const response = await handlers().fetch(
			new Request("https://dev.example/internal/events?op=listForumPosts&eventId=evt_1", {
				headers: { Authorization: `Bearer ${token}` },
			}),
		);
		const body = (await response.json()) as { posts: unknown[] };

		expect(response.status).toBe(200);
		expect(body.posts).toEqual([
			expect.objectContaining({
				id: "post_1",
				eventId: "evt_1",
				body: "Can I bring snacks?",
				anonymous: true,
				author: null,
			}),
		]);
	});
});
