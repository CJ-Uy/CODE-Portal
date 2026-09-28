import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createMembersRepository, type MemberDb } from "./members";
import { createRolesRepository } from "./roles";

const superActor: Actor = { memberId: "m_super", roles: ["super"] };
const memberAdmin: Actor = { memberId: "m_admin", roles: ["member_admin"] };
const plain: Actor = { memberId: "m_plain", roles: ["member"] };

function repos() {
	const db = drizzle(env.DB, { schema });
	const audit = createAuditRepository(db);
	return {
		db,
		members: createMembersRepository(db as unknown as MemberDb, audit),
		roles: createRolesRepository(db),
	};
}

describe("roles + member search on D1", () => {
	beforeEach(async () => {
		for (const t of ["audit_logs", "member_roles", "roles", "members"]) {
			await env.DB.prepare(`DELETE FROM ${t}`).run();
		}
		const roleSeed: [string, string, string][] = [
			["role_super", "super", "Overall Admin"],
			["role_member_admin", "member_admin", "Member Admin"],
			["role_publishing", "publishing", "Publishing"],
			["role_events", "events", "Events"],
			["role_member", "member", "Member"],
		];
		for (const [id, key, label] of roleSeed) {
			await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?,?,?,?,?)")
				.bind(id, key, label, `${label} role`, "system")
				.run();
		}
		const memberSeed: [string, string, string, string][] = [
			["m_super", "super@code.org", "Super Admin", "active"],
			["m_admin", "admin@code.org", "Member Admin", "active"],
			["m_plain", "plain@code.org", "Plain Member", "active"],
			["m_juan", "juan@code.org", "Juan Dela Cruz", "active"],
			["m_old", "old@code.org", "Old Member", "inactive"],
		];
		for (const [id, email, name, status] of memberSeed) {
			await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?,?,?,?)").bind(id, email, name, status).run();
		}
		const mr: [string, string][] = [
			["m_super", "role_super"],
			["m_admin", "role_member_admin"],
			["m_plain", "role_publishing"],
		];
		for (const [mid, rid] of mr) {
			await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_by) VALUES (?,?,?)").bind(mid, rid, "m_super").run();
		}
	});

	it("members.search: active only, name/email, min length, rejects unauthorized", async () => {
		const { members } = repos();
		expect((await members.search(memberAdmin, "dela")).map((m) => m.email)).toContain("juan@code.org");
		expect((await members.search(memberAdmin, "JUAN@")).length).toBe(1);
		expect(await members.search(memberAdmin, "old")).toEqual([]); // inactive excluded by default
		expect(await members.search(memberAdmin, "d")).toEqual([]); // < 2 chars
		await expect(members.search(plain, "dela")).rejects.toThrow(/Not authorized/);
	});

	it("members.search: includeInactive finds a member who is not active", async () => {
		// The roles page needs this. Access is often granted before someone is activated,
		// and the default filter made those people impossible to find at all.
		const { members } = repos();
		const found = await members.search(memberAdmin, "old", { includeInactive: true });
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((m) => m.status !== "active")).toBe(true);
		// The opt-in widens the search rather than replacing it: active members still match.
		expect((await members.search(memberAdmin, "dela", { includeInactive: true })).map((m) => m.email)).toContain(
			"juan@code.org",
		);
		// Authorization is unchanged by the option.
		await expect(members.search(plain, "old", { includeInactive: true })).rejects.toThrow(/Not authorized/);
	});

	it("lists assignable roles (no member, events active) and reads keys", async () => {
		const { roles } = repos();
		const list = await roles.listAssignableRoles(superActor);
		expect(list.find((r) => r.key === "member")).toBeUndefined();
		expect(list.find((r) => r.key === "events")?.assignable).toBe(true);
		expect(await roles.getMemberRoleKeys(superActor, "m_plain")).toEqual(["publishing"]);
		expect(roles.baseVersionOf(["publishing", "super"])).toBe("publishing|super");
	});

	it("normalizes legacy CRS role rows to retention", async () => {
		await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?,?,?,?,?)")
			.bind("role_crs", "crs", "CRS", "Legacy CRS role", "system")
			.run();
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_by) VALUES (?,?,?)")
			.bind("m_juan", "role_crs", "m_super")
			.run();

		const { roles } = repos();
		expect(await roles.getMemberRoleKeys(superActor, "m_juan")).toEqual(["retention"]);
		const base = roles.baseVersionOf(await roles.getMemberRoleKeys(superActor, "m_plain"));
		const res = await roles.saveMemberRoles(superActor, {
			memberId: "m_plain",
			desiredRoleKeys: ["publishing", "retention"],
			baseVersion: base,
		});
		expect(res.roleKeys).toEqual(["publishing", "retention"]);
	});

	it("normalizes legacy calendar role rows to events", async () => {
		await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?,?,?,?,?)")
			.bind("role_calendar", "calendar", "Calendar", "Legacy calendar role", "system")
			.run();
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_by) VALUES (?,?,?)")
			.bind("m_juan", "role_calendar", "m_super")
			.run();

		const { roles } = repos();
		expect(await roles.getMemberRoleKeys(superActor, "m_juan")).toEqual(["events"]);
	});

	it("listAdmins returns only members with a non-member role, plus their keys", async () => {
		const { roles } = repos();
		const admins = await roles.listAdmins(superActor);
		const byEmail = Object.fromEntries(admins.map((a) => [a.email, a.roleKeys]));
		// m_juan / m_old have no member_roles, so they are not admins.
		expect(Object.keys(byEmail).sort()).toEqual(["admin@code.org", "plain@code.org", "super@code.org"]);
		expect(byEmail["super@code.org"]).toEqual(["super"]);
		expect(byEmail["plain@code.org"]).toEqual(["publishing"]);
	});

	it("saves a diff atomically: adds member_admin, keeps publishing, writes audit", async () => {
		const { roles, db } = repos();
		const base = roles.baseVersionOf(await roles.getMemberRoleKeys(superActor, "m_plain"));
		const res = await roles.saveMemberRoles(superActor, {
			memberId: "m_plain",
			desiredRoleKeys: ["publishing", "member_admin"],
			baseVersion: base,
		});
		expect(res.roleKeys).toEqual(["member_admin", "publishing"]);
		const audits = await db.select().from(schema.auditLogs);
		expect(audits.some((a) => a.action === "role:assign" && a.category === "role")).toBe(true);
	});

	it("rejects a stale baseVersion (optimistic concurrency)", async () => {
		const { roles } = repos();
		await expect(
			roles.saveMemberRoles(superActor, { memberId: "m_plain", desiredRoleKeys: [], baseVersion: "stale" }),
		).rejects.toThrow(/reload/i);
	});

	it("non-super cannot grant Overall Admin via a desired set", async () => {
		const { roles } = repos();
		const base = roles.baseVersionOf(await roles.getMemberRoleKeys(memberAdmin, "m_plain"));
		await expect(
			roles.saveMemberRoles(memberAdmin, { memberId: "m_plain", desiredRoleKeys: ["publishing", "super"], baseVersion: base }),
		).rejects.toThrow(/Overall Admin/);
	});

	it("blocks removing the last Overall Admin", async () => {
		const { roles } = repos();
		const base = roles.baseVersionOf(await roles.getMemberRoleKeys(superActor, "m_super"));
		await expect(
			roles.saveMemberRoles(superActor, { memberId: "m_super", desiredRoleKeys: [], baseVersion: base }),
		).rejects.toThrow(/Overall Admin/);
	});

	it("assigns the active Events role", async () => {
		const { roles } = repos();
		const base = roles.baseVersionOf(await roles.getMemberRoleKeys(superActor, "m_plain"));
		await expect(
			roles.saveMemberRoles(superActor, { memberId: "m_plain", desiredRoleKeys: ["publishing", "events"], baseVersion: base }),
		).resolves.toEqual({ roleKeys: ["events", "publishing"] });
	});
});
