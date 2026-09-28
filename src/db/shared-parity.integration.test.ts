import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { memberRoles, members, roles, sharedDevTokens } from "@/db/schema";
import { SharedApiDatabaseAdapter } from "./adapters/shared-api";
import { createSharedRepositories } from "./repositories";
import { createAuditRepository } from "./repositories/audit";
import { createMembersRepository } from "./repositories/members";
import { createMembersInternalHandlers } from "@/server/internal/members";
import type { Actor } from "@/server/auth/permissions";
import { createAuthInternalHandlers } from "@/server/internal/auth";
import { createLinksInternalHandlers } from "@/server/internal/links";
import { createUploadsInternalHandlers } from "@/server/internal/uploads";
import type { StorageAdapter } from "@/storage/types";

const adminActor: Actor = {
	memberId: "mem_shared_admin",
	roles: ["super"],
};

const memberToken = "shared-member-token";

describe("shared members parity", () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM member_roles"),
			env.DB.prepare("DELETE FROM shared_dev_tokens"),
			env.DB.prepare("DELETE FROM roles"),
			env.DB.prepare("DELETE FROM members"),
		]);

		const db = drizzle(env.DB, { schema });
		await db.insert(members).values([
			{ id: "mem_shared_admin", email: "admin@example.com", name: "Admin" },
			{ id: "mem_shared_member", email: "member@example.com", name: "Member" },
		]);
		await db.insert(roles).values({ id: "role_super_test", key: "super", label: "Super", description: "Full access", kind: "admin" });
		await db.insert(memberRoles).values({ memberId: "mem_shared_admin", roleId: "role_super_test", assignedBy: "mem_shared_admin" });
		await db.insert(sharedDevTokens).values({
			tokenHash: await hashToken("shared-test-token"),
			memberId: "mem_shared_admin",
			label: "Test admin token",
		});
		await db.insert(sharedDevTokens).values({
			tokenHash: await hashToken(memberToken),
			memberId: "mem_shared_member",
			label: "Test member token",
		});
	});

	it("returns the same authorized member list over Drizzle and the internal proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const direct = createMembersRepository(db, createAuditRepository(db));
		const handlers = createMembersInternalHandlers({ db, deployEnv: "dev" });
		const adapter = new SharedApiDatabaseAdapter((request) => handlers.fetch(request), {
			baseUrl: "https://dev.example",
			token: "shared-test-token",
		});
		const shared = createSharedRepositories(adapter);

		const directMembers = await direct.list(adminActor, { limit: 10 });
		const sharedMembers = await shared.members.list(adminActor, { limit: 10 });

		expect(sharedMembers).toEqual(directMembers);
	});

	it("returns the same authorized member detail over Drizzle and the internal proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const direct = createMembersRepository(db, createAuditRepository(db));
		const handlers = createMembersInternalHandlers({ db, deployEnv: "dev" });
		const adapter = new SharedApiDatabaseAdapter(
			(request) => handlers.fetch(request, "mem_shared_member"),
			{ baseUrl: "https://dev.example", token: "shared-test-token" },
		);
		const shared = createSharedRepositories(adapter);

		const directMember = await direct.getById(adminActor, "mem_shared_member");
		const sharedMember = await shared.members.getById(adminActor, "mem_shared_member");

		expect(sharedMember).toEqual(directMember);
	});

	it("refuses a sharedDev deny operation over the proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createMembersInternalHandlers({ db, deployEnv: "dev" });
		const response = await handlers.fetch(
			new Request("https://dev.example/internal/members", {
				method: "POST",
				headers: {
					authorization: "Bearer shared-test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({ email: "blocked@example.com", name: "Blocked" }),
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Operation is disabled in shared development." });
	});

	it("enforces the same member management permission over the proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createMembersInternalHandlers({ db, deployEnv: "dev" });
		const response = await handlers.fetch(
			new Request("https://dev.example/internal/members", {
				headers: { authorization: `Bearer ${memberToken}` },
			}),
		);

		expect(response.status).toBe(403);
	});

	it("rejects requests without a mapped bearer token", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createMembersInternalHandlers({ db, deployEnv: "dev" });

		const response = await handlers.fetch(new Request("https://dev.example/internal/members"));

		expect(response.status).toBe(401);
	});

	it("applies the internal API CORS allowlist", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createMembersInternalHandlers({
			db,
			deployEnv: "dev",
			allowedOrigins: ["http://localhost:3000"],
		});
		const blocked = await handlers.fetch(
			new Request("https://dev.example/internal/members", {
				headers: {
					authorization: "Bearer shared-test-token",
					origin: "https://attacker.example",
				},
			}),
		);
		const allowed = await handlers.fetch(
			new Request("https://dev.example/internal/members", {
				headers: {
					authorization: "Bearer shared-test-token",
					origin: "http://localhost:3000",
				},
			}),
		);

		expect(blocked.status).toBe(403);
		expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
	});

	it("returns the token-mapped actor for shared mode", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createAuthInternalHandlers({ db, deployEnv: "dev" });

		const response = await handlers.fetch(
			new Request("https://dev.example/internal/auth", {
				headers: { authorization: "Bearer shared-test-token" },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			actor: {
				memberId: adminActor.memberId,
				roles: ["member", "super"],
				context: "shared_dev_token",
				sharedTokenLabel: "Test admin token",
			},
		});
	});

	it("returns 404 outside the dev Worker", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createMembersInternalHandlers({ db, deployEnv: "prod" });

		const response = await handlers.fetch(new Request("https://prod.example/internal/members"));

		expect(response.status).toBe(404);
	});

	it("authenticates shared upload deletes before applying the destructive-operation gate", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createUploadsInternalHandlers({
			db,
			deployEnv: "dev",
			storage: memoryStorage,
		});
		const key = "avatars/mem_shared_admin/avatar.png";

		const unauthenticated = await handlers.object(
			new Request("https://dev.example/internal/uploads/key", { method: "DELETE" }),
			key,
		);
		const authenticated = await handlers.object(
			new Request("https://dev.example/internal/uploads/key", {
				method: "DELETE",
				headers: { authorization: "Bearer shared-test-token" },
			}),
			key,
		);

		expect(unauthenticated.status).toBe(401);
		expect(authenticated.status).toBe(403);
	});

	it("keeps shared uploads read-only after authentication", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createUploadsInternalHandlers({ db, deployEnv: "dev", storage: memoryStorage });
		const unauthenticated = await handlers.collection(new Request("https://dev.example/internal/uploads", { method: "POST" }));
		const authenticated = await handlers.collection(new Request("https://dev.example/internal/uploads", {
			method: "POST",
			headers: { authorization: "Bearer shared-test-token" },
		}));

		expect(unauthenticated.status).toBe(401);
		expect(authenticated.status).toBe(403);
	});
});

describe("shared links parity", () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM link_hourly_stats"),
			env.DB.prepare("DELETE FROM link_daily_stats"),
			env.DB.prepare("DELETE FROM short_links"),
			env.DB.prepare("DELETE FROM shared_dev_tokens"),
			env.DB.prepare("DELETE FROM member_roles"),
			env.DB.prepare("DELETE FROM roles"),
			env.DB.prepare("DELETE FROM members"),
		]);
		const db = drizzle(env.DB, { schema });
		await db.insert(members).values({ id: "mem_links_owner", email: "links@example.com", name: "Links Owner" });
		await db.insert(sharedDevTokens).values({
			tokenHash: await hashToken("links-token"),
			memberId: "mem_links_owner",
			label: "Links token",
		});
	});

	it("lists a member's own links over the proxy and refuses create in shared mode", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "dev" });

		const created = await handlers.collection(
			new Request("https://dev.example/internal/links", {
				method: "POST",
				headers: { authorization: "Bearer links-token", "content-type": "application/json" },
				body: JSON.stringify({ slug: "welcome", destinationUrl: "https://example.com", title: "Welcome" }),
			}),
		);
		expect(created.status).toBe(403);
		expect(await created.json()).toEqual({ error: "Operation is disabled in shared development." });

		const listed = await handlers.collection(
			new Request("https://dev.example/internal/links", { headers: { authorization: "Bearer links-token" } }),
		);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({ links: [] });
	});

	it("returns 404 outside the dev Worker", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "prod" });
		const response = await handlers.collection(new Request("https://prod.example/internal/links"));
		expect(response.status).toBe(404);
	});

	it("returns 404 for missing link stats over the internal proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "dev" });
		const response = await handlers.stats(
			new Request("https://dev.example/internal/links/missing/stats", { headers: { authorization: "Bearer links-token" } }),
			"missing",
		);
		expect(response.status).toBe(404);
	});

	it("returns the first actionable analytics validation issue over the internal proxy", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "dev" });
		const response = await handlers.stats(
			new Request("https://dev.example/internal/links/missing/stats?timezone=Mars%2FOlympus", {
				headers: { authorization: "Bearer links-token" },
			}),
			"missing",
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Timezone must be a valid IANA timezone." });
	});

	it("resolves shared redirect requests and records clicks through the internal links handler", async () => {
		const db = drizzle(env.DB, { schema });
		await db.insert(schema.shortLinks).values({
			id: "lnk_shared_redirect",
			slug: "welcome",
			destinationUrl: "https://example.com/dest",
			title: "Welcome",
			ownerMemberId: "mem_links_owner",
		});
		const handlers = createLinksInternalHandlers({ db, deployEnv: "dev" });

		const response = await handlers.redirect(
			new Request("https://dev.example/internal/links/redirect/welcome?source=qr", { headers: { authorization: "Bearer links-token" } }),
			"welcome",
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://example.com/dest");
		const [link] = await db.select().from(schema.shortLinks).where(eq(schema.shortLinks.id, "lnk_shared_redirect"));
		expect(link.clickCount).toBe(1);
		const [daily] = await db.select().from(schema.linkDailyStats).where(eq(schema.linkDailyStats.linkId, "lnk_shared_redirect"));
		expect(daily.referrerBucket).toBe("qr scan");
	});
});

const memoryStorage: StorageAdapter = {
	adapterType: "local-fs",
	async putObject(input) {
		return { key: input.key };
	},
	async getObject() {
		return { body: null };
	},
	async deleteObject() {},
};

async function hashToken(token: string): Promise<string> {
	const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
