import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { claimPendingRoles, normalizePendingEmail } from "./pending-roles";

const NEW_MEMBER = "mem_newcomer";
const EMAIL = "Invited.Person@Example.com";

async function seedRole(id: string, key: string) {
	await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
		.bind(id, key, key, key, "admin")
		.run();
}

async function grantPending(email: string, roleId: string) {
	await env.DB.prepare("INSERT INTO pending_member_roles (email, role_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)")
		.bind(email, roleId, null, Date.now())
		.run();
}

async function roleIdsFor(memberId: string): Promise<string[]> {
	const { results } = await env.DB.prepare("SELECT role_id FROM member_roles WHERE member_id = ? ORDER BY role_id")
		.bind(memberId)
		.all<{ role_id: string }>();
	return results.map((row) => row.role_id);
}

async function pendingCount(): Promise<number> {
	const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM pending_member_roles").first<{ c: number }>();
	return row?.c ?? 0;
}

describe("claimPendingRoles", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM pending_member_roles").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM roles").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind(NEW_MEMBER, EMAIL.toLowerCase(), "Newcomer", Date.now(), Date.now())
			.run();
		await seedRole("role_events", "events");
		await seedRole("role_retention", "retention");
	});

	it("moves a role granted before the account existed onto the new member", async () => {
		await grantPending(EMAIL.toLowerCase(), "role_events");
		const claimed = await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL);
		expect(claimed).toBe(1);
		expect(await roleIdsFor(NEW_MEMBER)).toEqual(["role_events"]);
	});

	it("matches the invite regardless of the casing the member signs in with", async () => {
		// Invites are stored lowercased; Google can hand back any casing.
		await grantPending("invited.person@example.com", "role_events");
		const claimed = await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, "INVITED.PERSON@EXAMPLE.COM");
		expect(claimed).toBe(1);
		expect(await roleIdsFor(NEW_MEMBER)).toEqual(["role_events"]);
	});

	it("claims every waiting role at once", async () => {
		await grantPending(EMAIL.toLowerCase(), "role_events");
		await grantPending(EMAIL.toLowerCase(), "role_retention");
		expect(await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL)).toBe(2);
		expect(await roleIdsFor(NEW_MEMBER)).toEqual(["role_events", "role_retention"]);
	});

	it("removes the grant so it cannot be applied twice", async () => {
		await grantPending(EMAIL.toLowerCase(), "role_events");
		await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL);
		expect(await pendingCount()).toBe(0);
		// A second run is a no-op rather than an error.
		expect(await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL)).toBe(0);
		expect(await roleIdsFor(NEW_MEMBER)).toEqual(["role_events"]);
	});

	it("does not fail when the member already holds the role", async () => {
		// The bootstrap super grant runs first and may have already added it.
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES (?, ?, ?)")
			.bind(NEW_MEMBER, "role_events", Date.now())
			.run();
		await grantPending(EMAIL.toLowerCase(), "role_events");
		await expect(claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL)).resolves.toBe(1);
		expect(await roleIdsFor(NEW_MEMBER)).toEqual(["role_events"]);
	});

	it("leaves other invites alone", async () => {
		await grantPending(EMAIL.toLowerCase(), "role_events");
		await grantPending("someone.else@example.com", "role_retention");
		await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, EMAIL);
		expect(await pendingCount()).toBe(1);
	});

	it("does nothing for a blank email", async () => {
		await grantPending(EMAIL.toLowerCase(), "role_events");
		expect(await claimPendingRoles(drizzle(env.DB, { schema }), NEW_MEMBER, "   ")).toBe(0);
		expect(await pendingCount()).toBe(1);
	});
});

describe("normalizePendingEmail", () => {
	it("trims and lowercases so invites and sign-ins agree", () => {
		expect(normalizePendingEmail("  Person@Example.COM ")).toBe("person@example.com");
	});
});
