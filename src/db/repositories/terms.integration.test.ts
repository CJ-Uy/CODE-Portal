import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRetentionRepository } from "./retention";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const admin: Actor = { memberId: "mem_terms_admin", roles: ["super"] };
const plainMember: Actor = { memberId: "mem_terms_member", roles: ["member"] };

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function repo() {
	const db = drizzle(env.DB, { schema });
	return createRetentionRepository(db, createAuditRepository(db));
}

const sy2026 = {
	id: null,
	name: "SY 2026-2027",
	retainedAt: 20,
	probationBelow: 10,
	startsAt: day("2026-08-01"),
	endsAt: day("2027-07-31"),
};

describe("school year management", () => {
	beforeEach(async () => {
		for (const table of ["audit_logs", "retention_records", "term_member_roster", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_terms_admin", "terms-admin@example.com", "Terms Admin", "active")
			.run();
	});

	it("creates a school year and reports it as current when it covers today", async () => {
		const created = await repo().upsertTerm(admin, sy2026, NOW);
		expect(created.isCurrent).toBe(true);

		const rows = await repo().listTermsAdmin(admin, NOW);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: created.id, name: "SY 2026-2027", retainedAt: 20, isCurrent: true });
	});

	it("marks a school year that does not cover today as not current", async () => {
		await repo().upsertTerm(admin, sy2026, NOW);
		const rows = await repo().listTermsAdmin(admin, day("2028-01-01"));
		expect(rows[0].isCurrent).toBe(false);
	});

	it("rejects a second school year whose dates overlap an existing one", async () => {
		await repo().upsertTerm(admin, sy2026, NOW);
		await expect(
			repo().upsertTerm(
				admin,
				{ ...sy2026, name: "SY 2027-2028", startsAt: day("2027-07-31"), endsAt: day("2028-07-31") },
				NOW,
			),
		).rejects.toThrow(/overlap/i);
	});

	it("accepts a school year that starts after the previous one ends", async () => {
		await repo().upsertTerm(admin, sy2026, NOW);
		const next = await repo().upsertTerm(
			admin,
			{ ...sy2026, name: "SY 2027-2028", startsAt: day("2027-08-01"), endsAt: day("2028-07-31") },
			NOW,
		);
		expect(next.isCurrent).toBe(false);
		expect(await repo().listTermsAdmin(admin, NOW)).toHaveLength(2);
	});

	it("lets a school year keep its own dates when edited", async () => {
		const created = await repo().upsertTerm(admin, sy2026, NOW);
		const renamed = await repo().upsertTerm(admin, { ...sy2026, id: created.id, name: "SY 2026-27" }, NOW);
		expect(renamed.name).toBe("SY 2026-27");
	});

	it("edits a seed-era school year whose id predates createId", async () => {
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_2026_1", "Term 1 2026", 20, 10, day("2026-06-18").getTime(), day("2026-10-31").getTime())
			.run();

		const edited = await repo().upsertTerm(
			admin,
			{ ...sy2026, id: "term_2026_1", name: "SY 2026-2027", startsAt: day("2026-06-18"), endsAt: day("2026-10-31") },
			NOW,
		);

		expect(edited.id).toBe("term_2026_1");
		expect(edited.name).toBe("SY 2026-2027");
		expect(await repo().listTermsAdmin(admin, NOW)).toHaveLength(1);
	});

	it("rejects an end date on or before the start date", async () => {
		await expect(
			repo().upsertTerm(admin, { ...sy2026, endsAt: day("2026-08-01") }, NOW),
		).rejects.toThrow(/end date/i);
	});

	it("rejects a probation threshold above the retained threshold", async () => {
		await expect(
			repo().upsertTerm(admin, { ...sy2026, retainedAt: 10, probationBelow: 20 }, NOW),
		).rejects.toThrow(/probation/i);
	});

	it("refuses reads and writes without retention:configure", async () => {
		await expect(repo().upsertTerm(plainMember, sy2026, NOW)).rejects.toThrow(/Not authorized/);
		await expect(repo().listTermsAdmin(plainMember, NOW)).rejects.toThrow(/Not authorized/);
	});
});
