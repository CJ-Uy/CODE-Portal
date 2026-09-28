import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";

const admin: Actor = { memberId: "mem_admin", roles: ["retention"] };

describe("audit target member", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		for (const [id, email] of [
			["mem_admin", "admin@example.com"],
			["mem_target", "target@example.com"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, email, id, Date.now(), Date.now())
				.run();
		}
	});

	it("writes and queries target_member_id", async () => {
		const db = drizzle(env.DB, { schema });
		await createAuditRepository(db).record(admin, {
			action: "event:scan_attendance",
			targetType: "event",
			targetId: "evt_1",
			category: "event",
			detail: "member=mem_target",
			targetMemberId: "mem_target",
		});

		const rows = await db.select().from(auditLogs).where(eq(auditLogs.targetMemberId, "mem_target"));
		expect(rows).toHaveLength(1);
		expect(rows[0].action).toBe("event:scan_attendance");
	});
});