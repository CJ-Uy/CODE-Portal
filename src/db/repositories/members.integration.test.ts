import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import { isRosterSignInAllowed } from "@/server/auth/roster";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createMembersRepository } from "./members";

const adminActor: Actor = {
	memberId: "mem_test_admin",
	roles: ["super"],
};

const memberActor: Actor = {
	memberId: "mem_test_member",
	roles: ["member"],
};

describe("members repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
	});

	it("creates and lists members for an authorized actor", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(adminActor.memberId, "admin@example.com", "Admin")
			.run();
		const db = drizzle(env.DB, { schema });
		const repository = createMembersRepository(db, createAuditRepository(db));

		const created = await repository.create(adminActor, {
			email: "new-member@example.com",
			name: "New Member",
		});
		const listed = await repository.list(adminActor, { limit: 10 });
		const [audit] = await db.select().from(auditLogs);

		expect(created.email).toBe("new-member@example.com");
		expect(created.status).toBe("inactive");
		expect(listed.map((member) => member.id)).toContain(created.id);
		await expect(isRosterSignInAllowed(db, "new-member@example.com")).resolves.toBe(true);
		expect(audit).toMatchObject({
			actorMemberId: adminActor.memberId,
			action: "member:create",
			targetType: "member",
			targetId: created.id,
			category: "member",
		});
	});

	it("deletes members for an authorized actor and audits the change", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(adminActor.memberId, "admin@example.com", "Admin")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(memberActor.memberId, "member@example.com", "Member")
			.run();
		const db = drizzle(env.DB, { schema });
		const repository = createMembersRepository(db, createAuditRepository(db));

		await repository.delete(adminActor, memberActor.memberId);
		const listed = await repository.list(adminActor, { limit: 10 });
		const logs = await db.select().from(auditLogs);

		expect(listed.map((member) => member.id)).not.toContain(memberActor.memberId);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actorMemberId: adminActor.memberId,
					action: "member:delete",
					targetId: memberActor.memberId,
				}),
			]),
		);
	});

	it("rejects an admin read without member management permission", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createMembersRepository(db, createAuditRepository(db));

		await expect(repository.list(memberActor, { limit: 10 })).rejects.toThrow("Not authorized");
	});

	it("lets a member update their own profile and audits the change", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(memberActor.memberId, "member@example.com", "Member")
			.run();
		const db = drizzle(env.DB, { schema });
		const repository = createMembersRepository(db, createAuditRepository(db));

		const updated = await repository.updateProfile(memberActor, memberActor.memberId, {
			fullName: "Member Name",
			nickname: "Mem",
			pronouns: "they/them",
			batch: "2027",
			birthday: "2005-03-14",
			birthdayPrivate: true,
		});
		const [audit] = await db.select().from(auditLogs);

		expect(updated).toMatchObject({ fullName: "Member Name", nickname: "Mem", batch: "2027" });
		expect(audit).toMatchObject({
			actorMemberId: memberActor.memberId,
			action: "member:profile_update",
			targetId: memberActor.memberId,
		});
	});

	it("prevents a member from updating another profile", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createMembersRepository(db, createAuditRepository(db));

		await expect(
			repository.updateProfile(memberActor, "another-member", { nickname: "Nope" }),
		).rejects.toThrow("Not authorized");
	});
});
