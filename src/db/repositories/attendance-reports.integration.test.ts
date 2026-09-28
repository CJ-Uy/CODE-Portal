import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { attendanceStatus } from "@/lib/attendance-status";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { createAttendanceReports } from "./attendance-reports";

const admin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const outsider: Actor = { memberId: "mem_out", roles: ["member"] };

const EVENT_START = new Date("2026-07-10T10:00:00.000Z");
const TERM_START = new Date("2026-07-01T00:00:00.000Z");
const TERM_END = new Date("2026-08-01T00:00:00.000Z");

async function insertMember(id: string, email: string, name: string, fullName = name) {
	await env.DB.prepare("INSERT INTO members (id, email, name, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(id, email, name, fullName, TERM_START.getTime(), TERM_START.getTime())
		.run();
}

async function seedFixture() {
	await insertMember("mem_admin", "admin@example.com", "Admin", "Admin Member");
	await insertMember("mem_out", "out@example.com", "Out", "Outside Member");
	await insertMember("mem_ontime", "ontime@example.com", "On Time", "On Time Member");
	await insertMember("mem_late", "late@example.com", "Late", "Late Member");
	await insertMember("mem_absent", "absent@example.com", "Absent", "Absent Member");

	await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)")
		.bind("term_1", "Term 1", 20, 10, TERM_START.getTime(), TERM_END.getTime())
		.run();
	await env.DB.prepare("INSERT INTO point_types (id, key, label, active, position, updated_by) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(RETENTION_POINT_TYPE_ID, "retention", "Retention", 1, 0, "mem_admin")
		.run();
	await env.DB.prepare(
		"INSERT INTO crs_events (id, title, type, status, points, place, grace_minutes, starts_at, ends_at, description, created_by, approved_by, approved_at, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			"evt_1",
			"Case Workshop",
			"official",
			"approved",
			5,
			"SOM 111",
			15,
			EVENT_START.getTime(),
			EVENT_START.getTime() + 2 * 60 * 60 * 1000,
			"Practice cases",
			"mem_admin",
			"mem_admin",
			EVENT_START.getTime(),
			"secret",
		)
		.run();
	await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
		.bind("evt_1", "mem_ontime", EVENT_START.getTime() + 10 * 60_000, "mem_admin")
		.run();
	await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
		.bind("evt_1", "mem_late", EVENT_START.getTime() + 30 * 60_000, "mem_admin")
		.run();
	await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state, updated_at) VALUES (?, ?, ?, ?)")
		.bind("evt_1", "mem_absent", "going", EVENT_START.getTime())
		.run();
	await env.DB.prepare(
		"INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind("ret_ontime", "mem_ontime", "term_1", "evt_1", RETENTION_POINT_TYPE_ID, 5, "Attended Case Workshop", "event_attendance", "mem_admin", EVENT_START.getTime())
		.run();
	await env.DB.prepare(
		"INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind("ret_late", "mem_late", "term_1", "evt_1", RETENTION_POINT_TYPE_ID, 5, "Attended Case Workshop", "event_attendance", "mem_admin", EVENT_START.getTime())
		.run();
}

async function seedManyMembers(n: number) {
	for (let i = 0; i < n; i += 1) {
		const id = `mem_bulk_${String(i).padStart(3, "0")}`;
		await insertMember(id, `${id}@example.com`, `Bulk ${i}`, `Bulk Member ${String(i).padStart(3, "0")}`);
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
			.bind("evt_1", id, EVENT_START.getTime() + 5 * 60_000, "mem_admin")
			.run();
	}
}

async function seedUndo(input: { eventId: string; memberId: string; actorMemberId: string }) {
	await env.DB.prepare("DELETE FROM crs_attendance WHERE event_id = ? AND member_id = ?").bind(input.eventId, input.memberId).run();
	await env.DB.prepare(
		"INSERT INTO audit_logs (id, actor_member_id, action, target_type, target_id, detail, target_member_id, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			"aud_undo_late",
			input.actorMemberId,
			"event:undo_scan",
			"event",
			input.eventId,
			`member=${input.memberId}`,
			input.memberId,
			"event",
			EVENT_START.getTime() + 45 * 60_000,
		)
		.run();
}

describe("attendance reports", () => {
	beforeEach(async () => {
		for (const table of ["audit_logs", "crs_attendance", "event_rsvps", "retention_records", "crs_events", "terms", "point_types", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await seedFixture();
	});

	it("refuses an actor without retention:record", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		await expect(reports.termEventSummaries(outsider, "term_1")).rejects.toThrow("Not authorized to read attendance reports.");
	});

	it("counts late and absent against the event grace window", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const [summary] = await reports.termEventSummaries(admin, "term_1");
		expect(summary.attendedCount).toBe(2);
		expect(summary.lateCount).toBe(1);
		expect(summary.absentCount).toBe(1);
	});

	it("agrees with the shared status function on every roster row", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const roster = await reports.eventRoster(admin, "evt_1");
		expect(roster.length).toBeGreaterThan(0);
		const lateFromTs = roster.filter(
			(row) => row.scannedAt && attendanceStatus(row.scannedAt, row.startsAt, row.graceMinutes) === "late",
		).length;
		const [summary] = await reports.termEventSummaries(admin, "term_1");
		expect(lateFromTs).toBe(summary.lateCount);
		expect(lateFromTs).toBe(1);
	});

	it("quantizes fractional point totals in event, member, and attendance reports", async () => {
		for (const [id, points] of [["ret_fraction_a", 0.1], ["ret_fraction_b", 0.2]] as const) {
			await env.DB.prepare(
				"INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
				.bind(id, "mem_ontime", "term_1", "evt_1", RETENTION_POINT_TYPE_ID, points, id, "manual", "mem_admin", EVENT_START.getTime())
				.run();
		}

		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const [eventSummary] = await reports.termEventSummaries(admin, "term_1");
		const [memberSummary] = await reports.termMemberSummaries(admin, "term_1", { q: "ontime" });
		const [attendance] = await reports.memberAttendance(admin, "mem_ontime", "term_1");

		expect(eventSummary.pointsIssued).toBe(10.3);
		expect(memberSummary.pointsByType[RETENTION_POINT_TYPE_ID]).toBe(5.3);
		expect(attendance.pointsEarned).toBe(5.3);
	});

	it("caps limit at 200 however large the request", async () => {
		await seedManyMembers(250);
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const rows = await reports.termMemberSummaries(admin, "term_1", { limit: 5000, offset: 0 });
		expect(rows).toHaveLength(200);
	});

	it("filters members by name or email", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const rows = await reports.termMemberSummaries(admin, "term_1", { q: "late", limit: 50, offset: 0 });
		expect(rows).toHaveLength(1);
		expect(rows[0].memberId).toBe("mem_late");
	});

	it("keeps an undone scan visible in the scan log", async () => {
		await seedUndo({ eventId: "evt_1", memberId: "mem_late", actorMemberId: "mem_admin" });
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const rows = await reports.scanLog(admin, "term_1", { limit: 50, offset: 0 });
		expect(rows.some((row) => row.action === "event:undo_scan" && row.memberId === "mem_late")).toBe(true);
	});
});
