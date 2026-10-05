import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { mentorLine, mentsLabel, parseMentsPaste } from "@/lib/ments";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createMentsRepository } from "./ments";
import { createMentsInternalHandlers } from "@/server/internal/ments";
import { hashSharedToken } from "@/server/internal/shared-actor";

const admin: Actor = { memberId: "mnt_admin", roles: ["member_admin"] };
const member: Actor = { memberId: "mnt_member", roles: ["member"] };

async function setup() {
	await env.DB.prepare("INSERT OR IGNORE INTO members (id, email, name) VALUES (?, ?, ?)").bind(admin.memberId, "ments-admin@example.com", "Admin").run();
	const db = drizzle(env.DB, { schema });
	return { db, repo: createMentsRepository(db, createAuditRepository(db)) };
}

describe("ments tree on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("UPDATE ments_people SET mentor_id = NULL").run();
		await env.DB.prepare("DELETE FROM ments_people").run();
		await env.DB.prepare("DELETE FROM audit_logs WHERE target_type = 'ments_person'").run();
	});
	it("imports a complete line atomically, is repeatable, and keeps emails out of member reads", async () => {
		const { repo, db } = await setup();
		expect(await repo.import(admin, "Mentee\tMents\nGrandchild\tChild\nChild\tRoot")).toEqual({ added: 3, linked: 2 });
		expect(await repo.import(admin, "Grandchild\tChild\nChild\tRoot")).toEqual({ added: 0, linked: 0 });
		const grandchild = (await repo.list(member)).find((person) => person.name === "Grandchild")!;
		expect(mentorLine(await repo.list(member), grandchild.id).map((person) => person.name)).toEqual(["Child", "Root"]);
		await repo.save(admin, { id: grandchild.id, name: grandchild.name, mentorId: grandchild.mentorId, cohort: "2026", memberEmail: "ments-admin@example.com" });
		expect((await repo.list(member)).find((person) => person.id === grandchild.id)).not.toHaveProperty("memberEmail");
		expect((await repo.manage(admin)).find((person) => person.id === grandchild.id)?.memberEmail).toBe("ments-admin@example.com");
		expect((await db.select().from(schema.auditLogs)).map((row) => row.action)).toEqual(expect.arrayContaining(["ments:import", "ments:update"]));
	});

	it("imports the 200-row Sheets limit in one atomic D1 statement", async () => {
		const { repo } = await setup();
		const raw = Array.from({ length: 200 }, (_, index) => `Mentee ${index}\tMents ${index}`).join("\n");
		expect(await repo.import(admin, raw)).toEqual({ added: 400, linked: 200 });
		expect(await repo.list(member)).toHaveLength(400);
		await expect(repo.import(admin, `${raw}\nOverflow\tMents`)).rejects.toThrow("200");
		expect(await repo.list(member)).toHaveLength(400);
	});

	it("rejects cycles, conflicting imports, unknown mentors, and removing a mentor with mentees", async () => {
		const { repo } = await setup();
		await repo.import(admin, "Child\tRoot");
		const people = await repo.list(admin);
		const root = people.find((person) => person.name === "Root")!;
		const child = people.find((person) => person.name === "Child")!;
		await expect(repo.save(admin, { id: root.id, name: root.name, mentorId: child.id, cohort: null, memberEmail: null })).rejects.toThrow("loop");
		await expect(repo.import(admin, "Child\tOther")).rejects.toThrow("different ments");
		await expect(repo.import(admin, "New A\tNew B\nNew B\tNew A")).rejects.toThrow("loop");
		expect(await repo.list(admin)).toHaveLength(2);
		await expect(repo.remove(admin, root.id)).rejects.toThrow("Reassign");
		await expect(repo.save(admin, { name: "Bad", mentorId: "missing", cohort: null, memberEmail: null })).rejects.toThrow("Ments not found");
		await repo.remove(admin, child.id);
		await repo.remove(admin, root.id);
		expect(await repo.list(admin)).toEqual([]);
	});

	it("enforces cycle, unique account, and foreign key rules even outside the repository", async () => {
		await setup();
		await env.DB.prepare("INSERT INTO ments_people (id, name, mentor_id) VALUES ('a', 'A', NULL), ('b', 'B', 'a'), ('c', 'C', 'b')").run();
		await expect(env.DB.prepare("UPDATE ments_people SET mentor_id = 'c' WHERE id = 'a'").run()).rejects.toThrow("loop");
		await expect(env.DB.prepare("INSERT INTO ments_people (id, name, mentor_id) VALUES ('self', 'Self', 'self')").run()).rejects.toThrow();
		await expect(env.DB.prepare("UPDATE ments_people SET mentor_id = 'missing' WHERE id = 'c'").run()).rejects.toThrow();
		await env.DB.prepare("UPDATE ments_people SET member_id = ? WHERE id = 'a'").bind(admin.memberId).run();
		await expect(env.DB.prepare("UPDATE ments_people SET member_id = ? WHERE id = 'b'").bind(admin.memberId).run()).rejects.toThrow();
	});

	it("allows member reads but rejects every admin operation for ordinary members", async () => {
		const { repo, db } = await setup();
		expect(await repo.list(member)).toEqual([]);
		await expect(repo.manage(member)).rejects.toThrow("Not authorized");
		await expect(repo.save(member, { name: "No", cohort: null, mentorId: null, memberEmail: null })).rejects.toThrow("Not authorized");
		await expect(repo.remove(member, "id")).rejects.toThrow("Not authorized");
		await expect(repo.import(member, "No\tNo")).rejects.toThrow("Not authorized");
		expect((await createMentsInternalHandlers({ db, deployEnv: "prod", enabled: true }).fetch(new Request("https://example.com/internal/ments"))).status).toBe(404);
		expect((await createMentsInternalHandlers({ db, deployEnv: "dev", enabled: false }).fetch(new Request("https://example.com/internal/ments"))).status).toBe(404);
		expect((await createMentsInternalHandlers({ db, deployEnv: "dev", enabled: true }).fetch(new Request("https://example.com/internal/ments"))).status).toBe(401);
	});

	it("reads Sheets tabs without breaking commas in names and guards malformed input", () => {
		expect(parseMentsPaste("Mentee\tMents\r\nUY, Charles Joshua T.\tLOPEZ, Juan Miguel S.")).toEqual([{ name: "UY, Charles Joshua T.", mentor: "LOPEZ, Juan Miguel S." }]);
		expect(() => parseMentsPaste("\tRoot")).toThrow();
		expect(() => parseMentsPaste("A\tB\tC")).toThrow();
		expect([1, 2, 3].map(mentsLabel)).toEqual(["Ments", "Gments", "GGments"]);
	});

	it("serves authenticated shared developers and keeps management restricted", async () => {
		const { db } = await setup();
		await env.DB.prepare("UPDATE members SET status = 'active' WHERE id = ?").bind(admin.memberId).run();
		await env.DB.prepare("INSERT OR IGNORE INTO members (id, email, name, status) VALUES (?, 'ments-member@example.com', 'Member', 'active')").bind(member.memberId).run();
		await env.DB.prepare("INSERT OR IGNORE INTO roles (id, key, label, kind) VALUES ('mnt_role_admin', 'member_admin', 'Member admin', 'admin')").run();
		await env.DB.prepare("INSERT OR IGNORE INTO member_roles (member_id, role_id) SELECT ?, id FROM roles WHERE key = 'member_admin'").bind(admin.memberId).run();
		for (const actor of [admin, member]) {
			await db.insert(schema.sharedDevTokens).values({ tokenHash: await hashSharedToken(`test-${actor.memberId}`), memberId: actor.memberId, label: "Ments test" }).onConflictDoNothing();
		}
		const handlers = createMentsInternalHandlers({ db, deployEnv: "dev", enabled: true });
		const request = (actor: Actor, method: string, value?: unknown, query = "") => new Request(`https://example.com/internal/ments${query}`, {
			method, headers: { Authorization: `Bearer test-${actor.memberId}`, "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value),
		});
		expect((await handlers.fetch(request(admin, "PUT", { raw: "Shared Mentee\tShared Ments" }))).status).toBe(200);
		const response = await handlers.fetch(request(member, "GET"));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ people: [{ name: "Shared Mentee" }, { name: "Shared Ments" }] });
		expect((await handlers.fetch(request(member, "GET", undefined, "?manage=1"))).status).toBe(403);
		expect((await handlers.fetch(request(member, "PUT", { raw: "Denied\tShared Ments" }))).status).toBe(403);
	});
});
