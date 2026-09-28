import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { buildExistingAttendanceAwardUpsert, buildScanAwardUpsert } from "./event-awards";

describe("event attendance award upsert SQL", () => {
	it("uses the literal unqualified partial-index predicate", () => {
		const db = drizzle(env.DB, { schema });
		const queries = [
			buildExistingAttendanceAwardUpsert(db, "evt_1"),
			buildScanAwardUpsert(db, {
				eventId: "evt_1",
				memberId: "mem_1",
				termId: "term_1",
				scannedBy: "mem_admin",
				scannedAt: new Date("2026-07-10T10:00:00.000Z"),
			}),
		];

		for (const query of queries) {
			const generated = query.toSQL().sql;
			expect(generated).toContain("where source = 'event_attendance'");
			expect(generated).not.toContain('"retention_records"."source" = ?');
		}
	});
});
