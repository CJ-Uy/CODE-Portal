import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { termMemberRoster } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRosterRepository } from "./roster";

const admin: Actor = { memberId: "mem_admin", roles: ["member", "member_admin"] };
const TERM = "term_bulk";

function repo() {
	const db = drizzle(env.DB, { schema });
	return createRosterRepository(db, createAuditRepository(db));
}

describe("roster.bulkAdd on D1", () => {
	beforeEach(async () => {
		for (const t of ["audit_logs", "term_member_roster", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${t}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?,?,?)").bind("mem_admin", "admin@example.com", "Admin").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?,?,?)").bind("mem_a", "a@x.com", "A").run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?,?,?,?,?,?)",
		)
			.bind(TERM, "Bulk", 20, 10, 0, 9999999999999)
			.run();
	});

	it("adds new, skips existing, links member ids, reports counts", async () => {
		const r = repo();
		await r.add(admin, { termId: TERM, email: "a@x.com" });
		const res = await r.bulkAdd(admin, { termId: TERM, emails: ["a@x.com", "b@y.com", "c@z.com"] });
		expect(res).toEqual({ added: 2, alreadyMembers: 1 });
		const rows = await drizzle(env.DB, { schema }).select().from(termMemberRoster);
		expect(rows).toHaveLength(3);
		expect(rows.find((x) => x.email === "a@x.com")?.memberId).toBe("mem_a");
	});

	it("rejects over the 500 cap", async () => {
		const many = Array.from({ length: 501 }, (_, i) => `u${i}@x.com`);
		await expect(repo().bulkAdd(admin, { termId: TERM, emails: many })).rejects.toThrow(/500/);
	});

	it("rejects a non-authorized actor", async () => {
		await expect(repo().bulkAdd({ memberId: "x", roles: ["member"] }, { termId: TERM, emails: ["z@z.com"] })).rejects.toThrow(
			/Not authorized/,
		);
	});
});
