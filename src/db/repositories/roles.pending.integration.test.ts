import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createRolesRepository } from "./roles";

const memberAdmin: Actor = { memberId: "mem_admin", roles: ["member_admin"] };
const superAdmin: Actor = { memberId: "mem_super", roles: ["super"] };
const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };

const INVITED = "invited@example.com";
const TERM = "term_1";

function repo() {
	return createRolesRepository(drizzle(env.DB, { schema }));
}

describe("pending roles for invited people", () => {
	beforeEach(async () => {
		for (const table of ["pending_member_roles", "member_roles", "term_member_roster", "audit_logs", "roles", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const [id, key] of [
			["role_events", "events"],
			["role_member_admin", "member_admin"],
			["role_super", "super"],
		]) {
			await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
				.bind(id, key, key, key, "admin")
				.run();
		}
		for (const [id, email] of [
			["mem_admin", "admin@example.com"],
			["mem_super", "super@example.com"],
			["mem_signed_in", "signed.in@example.com"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, email, id, Date.now(), Date.now())
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(TERM, "Term", 10, 5, Date.now(), Date.now() + 86_400_000)
			.run();
		// One invite with no member row, and one roster row already linked to a member.
		await env.DB.prepare(
			"INSERT INTO term_member_roster (term_id, email, member_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(TERM, INVITED, null, "mem_admin", Date.now())
			.run();
		await env.DB.prepare(
			"INSERT INTO term_member_roster (term_id, email, member_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(TERM, "signed.in@example.com", "mem_signed_in", "mem_admin", Date.now())
			.run();
	});

	it("finds an invite that has no member row yet", async () => {
		const found = await repo().searchInvited(memberAdmin, "invited");
		expect(found.map((row) => row.email)).toEqual([INVITED]);
		expect(found[0].roleKeys).toEqual([]);
	});

	it("leaves out roster rows that already belong to a member", async () => {
		// Those people are editable through the normal admin path, so listing them here
		// would offer a grant that never applies.
		expect(await repo().searchInvited(memberAdmin, "signed.in")).toEqual([]);
	});

	it("ignores queries shorter than two characters", async () => {
		expect(await repo().searchInvited(memberAdmin, "i")).toEqual([]);
	});

	it("saves roles against the email and reads them back", async () => {
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["events"] });
		const found = await repo().searchInvited(memberAdmin, "invited");
		expect(found[0].roleKeys).toEqual(["events"]);
	});

	it("replaces rather than accumulates", async () => {
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["events", "member_admin"] });
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["events"] });
		expect((await repo().searchInvited(memberAdmin, "invited"))[0].roleKeys).toEqual(["events"]);
	});

	it("clears every waiting role when none are chosen", async () => {
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["events"] });
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: [] });
		expect((await repo().searchInvited(memberAdmin, "invited"))[0].roleKeys).toEqual([]);
	});

	it("normalises the email so it matches what sign-in will look up", async () => {
		await repo().savePendingRoles(memberAdmin, { email: "  INVITED@Example.COM ", desiredRoleKeys: ["events"] });
		const row = await env.DB.prepare("SELECT email FROM pending_member_roles LIMIT 1").first<{ email: string }>();
		expect(row?.email).toBe("invited@example.com");
	});

	it("refuses a caller without role:assign", async () => {
		await expect(repo().savePendingRoles(plainMember, { email: INVITED, desiredRoleKeys: ["events"] })).rejects.toThrow(
			/Not authorized/,
		);
		await expect(repo().searchInvited(plainMember, "invited")).rejects.toThrow(/Not authorized/);
	});

	it("stops a non-super granting super early", async () => {
		// Otherwise the pending path would be a way around the guard on saveMemberRoles.
		await expect(repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["super"] })).rejects.toThrow(
			/Overall Admin/,
		);
		await expect(repo().savePendingRoles(superAdmin, { email: INVITED, desiredRoleKeys: ["super"] })).resolves.toEqual({
			roleKeys: ["super"],
		});
	});

	it("refuses the implicit member role", async () => {
		await expect(repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["member"] })).rejects.toThrow(
			/not assignable/,
		);
	});

	it("audits the grant against the email", async () => {
		await repo().savePendingRoles(memberAdmin, { email: INVITED, desiredRoleKeys: ["events"] });
		const row = await env.DB.prepare(
			"SELECT target_id, action, detail FROM audit_logs WHERE category = 'role' ORDER BY created_at DESC LIMIT 1",
		).first<{ target_id: string; action: string; detail: string }>();
		expect(row?.target_id).toBe(INVITED);
		expect(row?.action).toBe("role:assign");
		expect(row?.detail).toBe("events");
	});
});
