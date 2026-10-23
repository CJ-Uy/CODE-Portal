import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRetentionRepository } from "./retention";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const plainMember: Actor = { memberId: "mem_a", roles: ["member"] };

const TERM_START = new Date("2026-06-01T00:00:00.000Z");
const TERM_END = new Date("2026-10-31T00:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createRetentionRepository(db, createAuditRepository(db)) };
}

async function insertRecord(input: {
	id: string;
	memberId?: string;
	termId?: string;
	pointTypeId?: string;
	points: number | null;
	reason?: string;
	recordedAt?: number;
}) {
	await env.DB.prepare(`
		INSERT INTO retention_records
			(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, 'manual', 'mem_admin', ?)
	`)
		.bind(
			input.id,
			input.memberId ?? "mem_a",
			input.termId ?? "term_1",
			input.pointTypeId ?? RETENTION_POINT_TYPE_ID,
			input.points,
			input.reason ?? input.id,
			input.recordedAt ?? TERM_START.getTime() + 1000,
		)
		.run();
}

describe("retention repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM retention_records").run();
		await env.DB.prepare("DELETE FROM crs_attendance").run();
		await env.DB.prepare("DELETE FROM event_rsvps").run();
		await env.DB.prepare("DELETE FROM crs_events").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM point_types").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_a", "a@example.com", "A", "Member A")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_b", "b@example.com", "B", "Member B")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", TERM_START.getTime(), TERM_END.getTime())
			.run();
		await env.DB.prepare(`
			INSERT INTO point_types
				(id, key, label, active, position, updated_by)
			VALUES
				('pt_retention', 'retention', 'Retention', 1, 0, 'mem_admin'),
				('pt_frontliner', 'frontliner', 'Frontliner', 1, 1, 'mem_admin'),
				('pt_retired', 'retired', 'Retired', 0, 2, 'mem_admin')
		`).run();
	});

	it("lets a member read their own term records but not another member's", async () => {
		const { repo } = makeRepo();
		await insertRecord({ id: "ret_read", points: 5, reason: "x" });
		const own = await repo.listForMember(plainMember, { memberId: "mem_a", termId: "term_1" });
		expect(own).toHaveLength(1);
		await expect(repo.listForMember(plainMember, { memberId: "mem_b", termId: "term_1" })).rejects.toThrow(
			"Not authorized",
		);
	});

	async function addParts() {
		await env.DB.prepare(`
			INSERT INTO point_types (id, key, label, retention_period, active, position, updated_by) VALUES
				('pt_ts', 'ts', 'Training Seminar', 'year', 1, 3, 'mem_admin'),
				('pt_gma', 'gma', 'General Membership Activity', 'semester', 1, 4, 'mem_admin')
		`).run();
	}

	// An event awarding 1 GMA point with a feedback form: mem_a checked in for 0.75 and can still earn 0.25 by answering.
	async function eventWithForm(status: "draft" | "running" | "closed" = "running", closesAt = TERM_END.getTime()) {
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt_gma', 'GMA Night', 'casual', 'Room', ?, 'd', 'mem_admin', 's')",
		)
			.bind(TERM_START.getTime() + 86_400_000)
			.run();
		await env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES ('evt_gma', 'pt_gma', 1)").run();
		await env.DB.prepare(`
			INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at)
			VALUES ('ret_att', 'mem_a', 'term_1', 'evt_gma', 'pt_gma', 0.75, 'Attended GMA Night', 'event_attendance', 'mem_admin', ?)
		`)
			.bind(TERM_START.getTime() + 86_400_000)
			.run();
		await env.DB.prepare("INSERT INTO surveys (id, event_id, title, status, created_by, closes_at) VALUES ('srv_gma', 'evt_gma', 'Feedback', ?, 'mem_admin', ?)")
			.bind(status, closesAt)
			.run();
	}

	const EARLY = new Date(TERM_START.getTime() + 7 * 86_400_000);

	it("counts each part's slot up to 1 point and keeps other point types out of retention", async () => {
		const { repo } = makeRepo();
		await addParts();
		for (const id of ["gma_1", "gma_2", "gma_3"]) await insertRecord({ id, pointTypeId: "pt_gma", points: 1 });
		await insertRecord({ id: "ret_old", pointTypeId: RETENTION_POINT_TYPE_ID, points: 20 });

		const progress = (await repo.memberProgress(plainMember, { memberId: "mem_a", termId: "term_1" }, EARLY))!;
		expect(progress).toMatchObject({ status: "on_track", met: 1, required: 3, missed: 0 });
		expect(progress.parts.map((part) => part.pointTypeId)).toEqual(["pt_ts", "pt_gma"]);
		expect(progress.parts[1].slots[0]).toMatchObject({ earned: 3, counted: 1, overflow: 2, state: "met" });
		expect(progress.parts[1].slots[1].state).toBe("upcoming");
		await expect(repo.memberProgress(plainMember, { memberId: "mem_b", termId: "term_1" }, EARLY)).rejects.toThrow("Not authorized");
		await expect(repo.memberProgress(retentionAdmin, { memberId: "mem_b", termId: "term_1" }, EARLY)).resolves.toMatchObject({ met: 0 });
	});

	it("reports progress for many members to retention admins only", async () => {
		const { repo } = makeRepo();
		await addParts();
		await insertRecord({ id: "ts_b", memberId: "mem_b", pointTypeId: "pt_ts", points: 1 });
		const progress = await repo.termProgress(retentionAdmin, "term_1", ["mem_a", "mem_b"], EARLY);
		expect([progress.get("mem_a")?.met, progress.get("mem_b")?.met]).toEqual([0, 1]);
		await expect(repo.termProgress(plainMember, "term_1", ["mem_a"], EARLY)).rejects.toThrow("Not authorized");
	});

	it("shows the share a member can still earn from an open or unopened form, and drops it once answered or closed", async () => {
		const { repo } = makeRepo();
		await addParts();
		await eventWithForm();
		const open = await repo.myHistory(plainMember, { termId: "term_1" }, EARLY);
		expect(open.pendingShares).toEqual([
			expect.objectContaining({ eventId: "evt_gma", surveyId: "srv_gma", surveyStatus: "running", pointTypeId: "pt_gma", pointTypeLabel: "General Membership Activity", points: 0.25 }),
		]);
		expect(open.progress?.parts[1].slots[0]).toMatchObject({ earned: 0.75, pending: 0.25, state: "open" });
		await expect(repo.eventFeedbackShare(plainMember, "evt_gma")).resolves.toMatchObject({ hasForm: true, pending: [expect.objectContaining({ points: 0.25 })] });

		await env.DB.prepare("UPDATE surveys SET status = 'draft' WHERE id = 'srv_gma'").run();
		expect((await repo.myHistory(plainMember, { termId: "term_1" }, EARLY)).pendingShares[0]).toMatchObject({ surveyStatus: "draft" });

		await env.DB.prepare("UPDATE surveys SET status = 'running', closes_at = ? WHERE id = 'srv_gma'").bind(EARLY.getTime() - 1).run();
		expect((await repo.myHistory(plainMember, { termId: "term_1" }, EARLY)).pendingShares).toEqual([]);

		await env.DB.prepare("UPDATE surveys SET closes_at = ? WHERE id = 'srv_gma'").bind(TERM_END.getTime()).run();
		await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id, completed_at) VALUES ('srv_gma', 'mem_a', ?)").bind(EARLY.getTime()).run();
		expect((await repo.myHistory(plainMember, { termId: "term_1" }, EARLY)).pendingShares).toEqual([]);
	});

	it("tells an event page whether the event has a feedback form", async () => {
		const { repo } = makeRepo();
		await addParts();
		await eventWithForm("draft");
		await expect(repo.eventFeedbackShare(plainMember, "evt_gma")).resolves.toMatchObject({ hasForm: true });
		await expect(repo.eventFeedbackShare(plainMember, "evt_none")).resolves.toEqual({ hasForm: false, pending: [] });
	});

	it("finds the soonest upcoming approved event for each retention part", async () => {
		const { repo } = makeRepo();
		await addParts();
		const insert = (id: string, startsAt: number, status = "approved") =>
			env.DB.prepare("INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, 'casual', ?, 'Room', ?, 'd', 'mem_admin', ?)")
				.bind(id, id, status, startsAt, `s_${id}`)
				.run();
		const day = 86_400_000;
		await insert("evt_past", EARLY.getTime() - day);
		await insert("evt_later", EARLY.getTime() + 9 * day);
		await insert("evt_soon", EARLY.getTime() + 2 * day);
		await insert("evt_pending", EARLY.getTime() + day, "pending");
		await insert("evt_other", EARLY.getTime() + day);
		for (const [eventId, pointTypeId] of [["evt_past", "pt_gma"], ["evt_later", "pt_gma"], ["evt_soon", "pt_gma"], ["evt_pending", "pt_gma"], ["evt_other", "pt_frontliner"], ["evt_later", "pt_ts"]]) {
			await env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, 1)").bind(eventId, pointTypeId).run();
		}
		const next = await repo.nextPartEvents(plainMember, EARLY);
		expect(Object.fromEntries([...next].map(([type, event]) => [type, event.eventId]))).toEqual({ pt_gma: "evt_soon", pt_ts: "evt_later" });
	});

	it("quantizes fractional leaderboard totals", async () => {
		const { repo } = makeRepo();
		await insertRecord({ id: "ret_fraction_a", points: 0.1 });
		await insertRecord({ id: "ret_fraction_b", points: 0.7 });

		const adminBoard = await repo.leaderboard(retentionAdmin, { termId: "term_1" });
		const publicBoard = await repo.publicLeaderboard(plainMember, {
			termId: "term_1",
			pointTypeId: RETENTION_POINT_TYPE_ID,
		});

		expect(adminBoard[0].totalPoints).toBe(0.8);
		expect(publicBoard[0].totalPoints).toBe(0.8);
	});

	it("ranks public leaderboard rows by the selected point type", async () => {
		const { repo } = makeRepo();
		await insertRecord({ id: "ret_a", memberId: "mem_a", pointTypeId: "pt_retention", points: 10 });
		await insertRecord({ id: "front_a", memberId: "mem_a", pointTypeId: "pt_frontliner", points: 1 });
		await insertRecord({ id: "ret_b", memberId: "mem_b", pointTypeId: "pt_retention", points: 5 });
		await insertRecord({ id: "front_b", memberId: "mem_b", pointTypeId: "pt_frontliner", points: 20 });

		const retentionTypeBoard = await repo.publicLeaderboard(plainMember, {
			termId: "term_1",
			pointTypeId: RETENTION_POINT_TYPE_ID,
		});
		const frontlinerBoard = await repo.publicLeaderboard(plainMember, {
			termId: "term_1",
			pointTypeId: "pt_frontliner",
		});

		expect(retentionTypeBoard.map((row) => [row.memberId, row.totalPoints])).toEqual([
			["mem_a", 10],
			["mem_b", 5],
		]);
		expect(frontlinerBoard.map((row) => [row.memberId, row.totalPoints])).toEqual([
			["mem_b", 20],
			["mem_a", 1],
		]);
	});

	it("ranks members by total points for the term leaderboard", async () => {
		const { repo } = makeRepo();
		await insertRecord({ id: "ret_board_a", memberId: "mem_a", points: 5, reason: "x" });
		await insertRecord({ id: "ret_board_b", memberId: "mem_b", points: 15, reason: "y" });
		const board = await repo.leaderboard(retentionAdmin, { termId: "term_1" });
		expect(board.map((row) => row.memberId)).toEqual(["mem_b", "mem_a"]);
		expect(board[0].totalPoints).toBe(15);
	});

	it("lists term, member, and event reporting rows for retention admins", async () => {
		const { repo } = makeRepo();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, points, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_report", "Practice Night", "official", "approved", 5, "SOM 111", 1000, "Practice", "mem_admin", "secret")
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(
				"ret_report_1",
				"mem_a",
				"term_1",
				"evt_report",
				"pt_retention",
				5,
				"Attended Practice Night",
				"event_attendance",
				"mem_admin",
				2000,
			)
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_report_2", "mem_a", "term_1", null, "pt_retention", null, "Submitted waiver", "manual", "mem_admin", 3000)
			.run();
		await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state) VALUES (?, ?, ?)")
			.bind("evt_report", "mem_a", "going")
			.run();
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
			.bind("evt_report", "mem_b", 2500, "mem_admin")
			.run();

		const termRows = await repo.listForTerm(retentionAdmin, "term_1");
		expect(termRows).toHaveLength(2);
		expect(termRows).toEqual(
			expect.arrayContaining([expect.objectContaining({ recordId: "ret_report_1", eventTitle: "Practice Night", points: 5 })]),
		);

		const memberRows = await repo.listMemberTermHistory(retentionAdmin, "mem_a", "term_1");
		expect(memberRows.map((row) => row.recordId)).toEqual(["ret_report_2", "ret_report_1"]);

		const eventRows = await repo.listForEvent(retentionAdmin, "evt_report");
		expect(eventRows).toEqual([
			expect.objectContaining({ memberEmail: "a@example.com", rsvped: true, attended: false }),
			expect.objectContaining({ memberEmail: "b@example.com", rsvped: false, attended: true }),
		]);

		const history = await repo.myHistory(plainMember, { termId: "term_1" });
		expect(history.records).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "ret_report_1", eventTitle: "Practice Night", eventType: "official" }),
			expect.objectContaining({ id: "ret_report_2", eventTitle: null, eventType: null, eventColour: null, points: null }),
		]));
	});

	it("returns point-type metadata without filtering row projections", async () => {
		const { repo } = makeRepo();
		await insertRecord({
			id: "ret_projection_retention",
			pointTypeId: "pt_retention",
			points: 5,
			recordedAt: TERM_START.getTime() + 1000,
		});
		await insertRecord({
			id: "ret_projection_frontliner",
			pointTypeId: "pt_frontliner",
			points: 7,
			recordedAt: TERM_START.getTime() + 2000,
		});

		const termRows = await repo.listForTerm(retentionAdmin, "term_1");
		const memberRows = await repo.listMemberTermHistory(retentionAdmin, "mem_a", "term_1");
		const ownRows = await repo.listForMember(plainMember, { memberId: "mem_a", termId: "term_1" });
		const history = await repo.myHistory(plainMember, { termId: "term_1" });

		expect(termRows.map((row) => row.pointTypeLabel)).toEqual(["Frontliner", "Retention"]);
		expect(memberRows.map((row) => row.pointTypeId)).toEqual(["pt_frontliner", "pt_retention"]);
		expect(ownRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ pointTypeLabel: "Retention" }),
				expect.objectContaining({ pointTypeLabel: "Frontliner" }),
			]),
		);
		expect(history.records.map((row) => row.pointTypeLabel).sort()).toEqual(["Frontliner", "Retention"]);
	});

	it("paginates the term ledger deterministically across tied timestamps", async () => {
		const { repo } = makeRepo();
		const at = Date.now();
		await insertRecord({ id: "rec_1", points: 1, recordedAt: at });
		await insertRecord({ id: "rec_2", points: 2, recordedAt: at });

		const page1 = await repo.listForTerm(retentionAdmin, "term_1", { limit: 1, offset: 0 });
		const page2 = await repo.listForTerm(retentionAdmin, "term_1", { limit: 1, offset: 1 });
		expect(page1).toHaveLength(1);
		expect(page2).toHaveLength(1);
		expect(page1[0].recordId).not.toBe(page2[0].recordId);
	});

	it("rejects reporting reads from actors without retention scope", async () => {
		const { repo } = makeRepo();
		await expect(repo.listForTerm(plainMember, "term_1")).rejects.toThrow("Not authorized");
		await expect(repo.listMemberTermHistory(plainMember, "mem_a", "term_1")).rejects.toThrow("Not authorized");
		await expect(repo.listForEvent(plainMember, "evt_missing")).rejects.toThrow("Not authorized");
	});

	it("records one manual entry across multiple members in a single batch", async () => {
		const { db, repo } = makeRepo();

		const result = await repo.createManual(retentionAdmin, {
			memberIds: ["mem_a", "mem_b"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_retention",
			points: null,
			reason: "Submitted the required medical waiver",
		});

		const rows = await db.select().from(schema.retentionRecords);
		expect(result.recordIds).toHaveLength(2);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.source === "manual")).toBe(true);
		expect(rows.every((row) => row.points === null)).toBe(true);
		expect(rows.every((row) => row.recordedBy === "mem_admin")).toBe(true);
		expect(rows.map((row) => row.memberId).sort()).toEqual(["mem_a", "mem_b"]);
	});

	it("stores a negative manual point value as a deduction", async () => {
		const { db, repo } = makeRepo();

		await repo.createManual(retentionAdmin, {
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_retention",
			points: -5,
			reason: "Logged violation",
		});

		const [row] = await db.select().from(schema.retentionRecords);
		expect(row.points).toBe(-5);
	});

	it("quantizes a direct manual repository write to two decimals", async () => {
		const { db, repo } = makeRepo();

		await repo.createManual(retentionAdmin, {
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_retention",
			points: -0.755,
			reason: "Fractional deduction",
		});

		const [row] = await db.select().from(schema.retentionRecords);
		expect(row.points).toBe(-0.76);
	});

	it("requires an active point type and records it", async () => {
		const { db, repo } = makeRepo();
		await repo.createManual(retentionAdmin, {
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_frontliner",
			points: 3,
			reason: "Led a project",
		});
		expect((await db.select().from(schema.retentionRecords))[0].pointTypeId).toBe("pt_frontliner");

		await expect(
			repo.createManual(retentionAdmin, {
				memberIds: ["mem_a"],
				termId: "term_1",
				eventId: null,
				pointTypeId: "pt_missing",
				points: 3,
				reason: "Unknown type",
			}),
		).rejects.toThrow("Point type is not active");

		await expect(
			repo.createManual(retentionAdmin, {
				memberIds: ["mem_a"],
				termId: "term_1",
				eventId: null,
				pointTypeId: "pt_retired",
				points: 3,
				reason: "Retired type",
			}),
		).rejects.toThrow("Point type is not active");
	});

	it("writes one manual retention audit row per member", async () => {
		const { db, repo } = makeRepo();

		await repo.createManual(retentionAdmin, {
			memberIds: ["mem_a", "mem_b"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_retention",
			points: 3,
			reason: "Attended makeup session",
		});

		const audits = await db.select().from(schema.auditLogs);
		expect(audits).toHaveLength(2);
		expect(audits.every((row) => row.category === "retention")).toBe(true);
		expect(audits.every((row) => row.action === "retention:record_manual")).toBe(true);
	});

	it("rejects a manual entry from an actor without the retention:record permission", async () => {
		const { db, repo } = makeRepo();

		await expect(
			repo.createManual(plainMember, {
				memberIds: ["mem_a"],
				termId: "term_1",
				eventId: null,
				pointTypeId: "pt_retention",
				points: null,
				reason: "Nope",
			}),
		).rejects.toThrow("Not authorized");
		expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);
	});

	it("rejects an unknown manual term and writes nothing", async () => {
		const { db, repo } = makeRepo();

		await expect(
			repo.createManual(retentionAdmin, {
				memberIds: ["mem_a"],
				termId: "term_missing",
				eventId: null,
				pointTypeId: "pt_retention",
				points: null,
				reason: "Bad term",
			}),
		).rejects.toThrow("Term not found");
		expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);
	});

	describe("myHistory and listTerms", () => {
		const NOW = new Date("2026-07-01T00:00:00.000Z");

		beforeEach(async () => {
			await env.DB.prepare(
				"INSERT INTO terms (id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)",
			)
				.bind("term_past", "Past Term", Date.UTC(2025, 4, 1), Date.UTC(2025, 6, 30))
				.run();
		});

		it("summarizes the current term and excludes past-term and other members' records", async () => {
			const { repo } = makeRepo();
			await insertRecord({ id: "ret_history_a", memberId: "mem_a", termId: "term_1", points: 5, reason: "Attended" });
			await repo.createManual(retentionAdmin, {
				memberIds: ["mem_a"],
				termId: "term_1",
				eventId: null,
				pointTypeId: "pt_retention",
				points: -2,
				reason: "Violation",
			});
			await insertRecord({ id: "ret_history_past", memberId: "mem_a", termId: "term_past", points: 50, reason: "Old points" });
			await insertRecord({ id: "ret_history_b", memberId: "mem_b", termId: "term_1", points: 99, reason: "Theirs" });

			const { summary, records, progress } = await repo.myHistory(plainMember, { termId: "term_1" }, NOW);
			expect(summary?.recordCount).toBe(2);
			expect(progress).toMatchObject({ required: 0 });
			expect(records).toHaveLength(2);
			expect(records.every((record) => record.memberId === "mem_a")).toBe(true);
		});

		it("defaults to the current term when no termId is given", async () => {
			const { repo } = makeRepo();
			const { summary } = await repo.myHistory(plainMember, {}, NOW);
			expect(summary?.termId).toBe("term_1");
		});

		it("lists the member's terms with the current one flagged", async () => {
			const { repo } = makeRepo();
			const terms = await repo.listTerms(plainMember, NOW);
			const current = terms.find((term) => term.isCurrent);
			expect(current?.id).toBe("term_1");
			expect(terms.map((term) => term.id)).toContain("term_past");
		});
	});

	describe("myPointsByDay", () => {
		// 2026-07-15T16:30Z is 2026-07-16 00:30 in UTC+8. A late-evening scan has to land on the
		// day the member actually attended, which is what the month grid labels the cell.
		it("groups on the UTC+8 day, not the UTC day", async () => {
			const { repo } = makeRepo();
			await insertRecord({ id: "r_late", points: 2, recordedAt: Date.parse("2026-07-15T16:30:00.000Z") });
			await insertRecord({ id: "r_early", points: 1, recordedAt: Date.parse("2026-07-15T15:00:00.000Z") });

			const days = await repo.myPointsByDay(plainMember, { year: 2026, month: 7 });
			const byDate = new Map(days.map((day) => [day.date, day.points]));
			expect(byDate.get("2026-07-16")).toBe(2);
			expect(byDate.get("2026-07-15")).toBe(1);
		});

		it("sums fractional points for a day without float dust", async () => {
			const { repo } = makeRepo();
			for (const [index, points] of [0.1, 0.2, 0.75].entries()) {
				await insertRecord({
					id: `r_frac_${index}`,
					points,
					recordedAt: Date.parse("2026-07-20T02:00:00.000Z"),
				});
			}
			const days = await repo.myPointsByDay(plainMember, { year: 2026, month: 7 });
			expect(days).toEqual([{ date: "2026-07-20", points: 1.05, records: 3 }]);
		});

		it("counts a null-points attendance note as a record worth zero", async () => {
			const { repo } = makeRepo();
			await insertRecord({ id: "r_note", points: null, recordedAt: Date.parse("2026-07-21T02:00:00.000Z") });
			const days = await repo.myPointsByDay(plainMember, { year: 2026, month: 7 });
			expect(days).toEqual([{ date: "2026-07-21", points: 0, records: 1 }]);
		});

		it("excludes other members and other months", async () => {
			const { repo } = makeRepo();
			await insertRecord({ id: "r_mine", points: 3, recordedAt: Date.parse("2026-07-10T02:00:00.000Z") });
			await insertRecord({ id: "r_theirs", memberId: "mem_b", points: 9, recordedAt: Date.parse("2026-07-10T02:00:00.000Z") });
			await insertRecord({ id: "r_august", points: 7, recordedAt: Date.parse("2026-08-10T02:00:00.000Z") });

			const days = await repo.myPointsByDay(plainMember, { year: 2026, month: 7 });
			expect(days).toEqual([{ date: "2026-07-10", points: 3, records: 1 }]);
		});
	});

});
