import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createQuickLinksRepository } from "./quickLinks";

const navAdmin: Actor = { memberId: "mem_ql_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

describe("quick links repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM quick_links").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(navAdmin.memberId, "ql@example.com", "QL Admin")
			.run();
	});

	it("lets a member_admin create, update, list, and remove a quick link with audit", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createQuickLinksRepository(db, createAuditRepository(db));

		const created = await repository.create(navAdmin, {
			label: "Member Directory",
			url: "https://example.com/directory",
			position: 1,
		});
		const updated = await repository.update(navAdmin, created.id, {
			label: "Directory",
			url: "https://example.com/directory",
			position: 3,
		});
		expect(updated.position).toBe(3);

		await repository.remove(navAdmin, created.id);
		expect(await repository.list(navAdmin)).toHaveLength(0);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(
			expect.arrayContaining(["quick_link:create", "quick_link:update", "quick_link:delete"]),
		);
	});

	it("rejects a plain member", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createQuickLinksRepository(db, createAuditRepository(db));
		await expect(repository.list(member)).rejects.toThrow("Not authorized");
	});
});
