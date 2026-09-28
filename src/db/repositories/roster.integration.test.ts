import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, termMemberRoster } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRosterRepository } from "./roster";

const rosterAdmin: Actor = { memberId: "mem_roster_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };
const TERM = "term_x";

describe("roster repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM term_member_roster").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(rosterAdmin.memberId, "admin@example.com", "Roster Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(TERM, "Term X", 20, 10, 0, 9999999999999)
			.run();
	});

	it("adds an email normalized, lists it, and removes it with audit", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));

		const entry = await repository.add(rosterAdmin, { termId: TERM, email: "  New.Member@Example.COM " });
		expect(entry.email).toBe("new.member@example.com");

		await repository.remove(rosterAdmin, TERM, "new.member@example.com");
		expect(await repository.listForTerm(rosterAdmin, TERM)).toHaveLength(0);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["roster:add", "roster:remove"]));
		expect(audits.every((row) => row.category === "retention")).toBe(true);
	});

	it("rejects a plain member from listing or mutating the roster", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));
		await expect(repository.listForTerm(member, TERM)).rejects.toThrow("Not authorized");
		await expect(repository.add(member, { termId: TERM, email: "x@example.com" })).rejects.toThrow("Not authorized");
	});

	it("is idempotent on re-adding the same email", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));
		await repository.add(rosterAdmin, { termId: TERM, email: "dup@example.com" });
		await repository.add(rosterAdmin, { termId: TERM, email: "dup@example.com" });
		expect(await db.select().from(termMemberRoster)).toHaveLength(1);
	});
});
