import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { retentionRecords } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventsRepository } from "./events";
import { createSurveysRepository } from "./surveys";

const owner: Actor = { memberId: "mem_owner", roles: ["member"] };
const eventsAdmin: Actor = { memberId: "mem_events", roles: ["events"] };
const memberA: Actor = { memberId: "mem_a", roles: ["member"] };
const memberB: Actor = { memberId: "mem_b", roles: ["member"] };

function repos() {
	const db = drizzle(env.DB, { schema });
	const audit = createAuditRepository(db);
	return { db, events: createEventsRepository(db, audit), surveys: createSurveysRepository(db, audit) };
}

async function records(memberId: string) {
	const { db } = repos();
	const rows = await db.select().from(retentionRecords).where(eq(retentionRecords.memberId, memberId)).orderBy(retentionRecords.source, retentionRecords.pointTypeId);
	return rows.map((row) => [row.source, row.pointTypeId, row.points]);
}

async function makeEvent(title = "GMA Night") {
	const { events } = repos();
	const event = await events.create(owner, {
		title,
		type: "casual",
		place: "SOM 111",
		description: "GMA",
		startsAt: new Date("2026-07-10T10:00:00.000Z"),
		endsAt: new Date("2026-07-10T12:00:00.000Z"),
		capacity: null,
	});
	await events.setAwards(eventsAdmin, event.id, [
		{ pointTypeId: "pt_gma", points: 1 },
		{ pointTypeId: "pt_frontliner", points: 0.5 },
	]);
	return event;
}

// Walk-ins are off and nobody is invited: an attendee must still be able to answer an event's form.
async function attachForm(eventId: string | null, id = `srv_${eventId ?? "general"}`) {
	await env.DB.prepare(
		`INSERT INTO surveys (id, event_id, title, status, created_by, closes_at, allow_walk_in, points_award, point_type_id)
		 VALUES (?, ?, 'Feedback', 'running', 'mem_owner', ?, 0, 1, 'pt_feedback')`,
	)
		.bind(id, eventId, new Date("2026-07-20T00:00:00.000Z").getTime())
		.run();
	return id;
}

describe("feedback share of event points", () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-10T10:05:00.000Z"));
		for (const table of ["retention_records", "survey_answers", "survey_responses", "survey_assignments", "surveys", "crs_attendance", "event_point_awards", "event_staff", "crs_events", "event_type_rules", "terms", "point_types", "audit_logs", "notifications", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_owner", "mem_events", "mem_a", "mem_b", "mem_scanner"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)").bind(id, `${id}@example.com`, id, id).run();
		}
		for (const [id, key, label, period, position] of [
			["pt_gma", "gma", "General Membership Activity", "semester", 0],
			["pt_frontliner", "frontliner", "Frontliner", null, 1],
			["pt_feedback", "feedback", "Feedback", null, 2],
		] as const) {
			await env.DB.prepare("INSERT INTO point_types (id, key, label, retention_period, active, position) VALUES (?, ?, ?, ?, 1, ?)").bind(id, key, label, period, position).run();
		}
		await env.DB.prepare("INSERT INTO terms (id, name, starts_at, ends_at) VALUES ('term_1', 'Term 1', ?, ?)")
			.bind(new Date("2026-06-01T00:00:00Z").getTime(), new Date("2026-10-31T00:00:00Z").getTime())
			.run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission, label, colour, active, position) VALUES ('casual', NULL, 'Casual', 'emerald', 1, 0)").run();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pays 75% at check-in when the event has a feedback form, and 100% without one", async () => {
		const { events } = repos();
		const withForm = await makeEvent();
		await attachForm(withForm.id);
		const without = await makeEvent("Casual Night");
		await events.recordScan(owner, { eventId: withForm.id, memberId: "mem_a", termId: "term_1" });
		await events.recordScan(owner, { eventId: without.id, memberId: "mem_b", termId: "term_1" });
		expect(await records("mem_a")).toEqual([
			["event_attendance", "pt_frontliner", 0.38],
			["event_attendance", "pt_gma", 0.75],
		]);
		expect(await records("mem_b")).toEqual([
			["event_attendance", "pt_frontliner", 0.5],
			["event_attendance", "pt_gma", 1],
		]);
		const { db } = repos();
		const [row] = await db.select().from(retentionRecords).where(and(eq(retentionRecords.memberId, "mem_a"), eq(retentionRecords.pointTypeId, "pt_gma")));
		expect(row.reason).toBe("Attended GMA Night (75% now, 25% for the feedback form)");
	});

	it("pays organizers 100% because they cannot answer the form", async () => {
		const { events } = repos();
		const event = await makeEvent();
		await attachForm(event.id);
		await events.addStaff(owner, event.id, "mem_scanner", "scanner");
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_scanner", termId: "term_1" });
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_owner", termId: "term_1" });
		expect(await records("mem_scanner")).toEqual([
			["event_attendance", "pt_frontliner", 0.5],
			["event_attendance", "pt_gma", 1],
		]);
		expect(await records("mem_owner")).toEqual([
			["event_attendance", "pt_frontliner", 0.5],
			["event_attendance", "pt_gma", 1],
		]);
	});

	it("gives the other 25% as a feedback share when an attendee answers, with no separate Feedback point", async () => {
		const { events, surveys } = repos();
		const event = await makeEvent();
		const surveyId = await attachForm(event.id);
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
		vi.setSystemTime(new Date("2026-07-11T02:00:00.000Z"));
		await surveys.submitResponse(memberA, { surveyId, answers: [] });
		expect(await records("mem_a")).toEqual([
			["event_attendance", "pt_frontliner", 0.38],
			["event_attendance", "pt_gma", 0.75],
			["feedback_share", "pt_frontliner", 0.12],
			["feedback_share", "pt_gma", 0.25],
		]);
		const { db } = repos();
		const [share] = await db.select().from(retentionRecords).where(and(eq(retentionRecords.source, "feedback_share"), eq(retentionRecords.pointTypeId, "pt_gma")));
		expect(share).toMatchObject({ termId: "term_1", eventId: event.id, recordedAt: new Date("2026-07-11T02:00:00.000Z") });
	});

	it("gives nothing more to a member who checked in before the form existed", async () => {
		const { events, surveys } = repos();
		const event = await makeEvent();
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_b", termId: "term_1" });
		const surveyId = await attachForm(event.id);
		await surveys.submitResponse(memberB, { surveyId, answers: [] });
		expect(await records("mem_b")).toEqual([
			["event_attendance", "pt_frontliner", 0.5],
			["event_attendance", "pt_gma", 1],
		]);
	});

	it("keeps check-in and feedback shares summing to the award when awards change, and drops removed types", async () => {
		const { events, surveys } = repos();
		const event = await makeEvent();
		const surveyId = await attachForm(event.id);
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
		await surveys.submitResponse(memberA, { surveyId, answers: [] });
		await events.setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_gma", points: 2 }]);
		expect(await records("mem_a")).toEqual([
			["event_attendance", "pt_gma", 1.5],
			["feedback_share", "pt_gma", 0.5],
		]);
	});

	it("removes the feedback share when the check-in is undone", async () => {
		const { events, surveys } = repos();
		const event = await makeEvent();
		const surveyId = await attachForm(event.id);
		await events.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
		await surveys.submitResponse(memberA, { surveyId, answers: [] });
		await events.undoScan(owner, { eventId: event.id, memberId: "mem_a" });
		expect(await records("mem_a")).toEqual([]);
	});

	it("keeps points for answering on a form with no event", async () => {
		const { surveys } = repos();
		const surveyId = await attachForm(null);
		await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id) VALUES (?, 'mem_a')").bind(surveyId).run();
		await surveys.submitResponse(memberA, { surveyId, answers: [] });
		expect(await records("mem_a")).toEqual([["survey_response", "pt_feedback", 1]]);
	});
});
