import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { surveyAssignments, surveys } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createSurveysRepository, type SurveysRepository } from "./surveys";

const admin: Actor = { memberId: "mem_admin", roles: ["super"] };
const member: Actor = { memberId: "mem_member", roles: ["member"] };

async function seedMembers(count: number) {
	for (let i = 0; i < count; i += 1) {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind(`mem_${i}`, `m${i}@example.com`, `M${i}`, "active")
			.run();
	}
}

function setup() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createSurveysRepository(db, createAuditRepository(db)) };
}

// The sample is seeded, so read who was drawn instead of guessing.
async function assignedIds(db: ReturnType<typeof setup>["db"], surveyId: string) {
	const rows = await db.select().from(surveyAssignments).where(eq(surveyAssignments.surveyId, surveyId));
	return rows.map((row) => row.memberId);
}

const asMember = (memberId: string): Actor => ({ memberId, roles: ["member"] });

async function seedEvent(id = "evt_1", title = "Study Jam") {
	await env.DB.prepare(
		"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, title, "official", "approved", "Room", 0, "Test event", "mem_admin", "secret")
		.run();
}

async function seedAttendance(eventId: string, memberIds: string[]) {
	await env.DB.batch(
		memberIds.map((memberId) =>
			env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)").bind(
				eventId,
				memberId,
				0,
				"mem_admin",
			),
		),
	);
}

const NOW = new Date("2026-10-16T00:00:00.000Z");
const HOUR = 3_600_000;
const in72h = new Date(NOW.getTime() + 72 * HOUR);

// A fixed-seed send of an exact head count, for tests that only need a running form with invitees.
const sendCount = (repo: SurveysRepository, surveyId: string, count: number, extra: Partial<Parameters<SurveysRepository["send"]>[1]> = {}) =>
	repo.send(
		admin,
		{
			surveyId,
			invite: { mode: "count", count },
			allowWalkIn: true,
			shareWithOrganizers: true,
			emailInvitees: false,
			remind: true,
			closesAt: in72h,
			seed: "fixed",
			pointsAward: 0,
			pointTypeId: null,
			...extra,
		},
		NOW,
	);

const textQuestions = (count: number) =>
	Array.from({ length: count }, (_, i) => ({ type: "text" as const, prompt: `Q${i + 1}`, required: false }));

describe("surveys repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM survey_answers").run();
		await env.DB.prepare("DELETE FROM survey_responses").run();
		await env.DB.prepare("DELETE FROM survey_assignments").run();
		await env.DB.prepare("DELETE FROM survey_questions").run();
		await env.DB.prepare("DELETE FROM surveys").run();
		// Keep the three migration-seeded templates; drop whatever a test saved.
		await env.DB.prepare("DELETE FROM survey_templates WHERE id NOT IN ('stpl_standard', 'stpl_pulse', 'stpl_workshop')").run();
		await env.DB.prepare("UPDATE survey_templates SET archived_at = NULL").run();
		await env.DB.prepare("DELETE FROM crs_events").run();
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "active")
			.run();
	});

	it("creates a survey with ordered questions and audits it", async () => {
		const { db, repo } = setup();

		const survey = await repo.create(admin, {
			title: "Practice Night Feedback",
			questions: [
				{ type: "scale", prompt: "How useful was it?", options: ["Not useful", "Very useful"], required: true },
				{ type: "text", prompt: "Anything to add?", required: false },
			],
		});

		const detail = await repo.getById(admin, survey.id);
		const [audit] = await db.select().from(schema.auditLogs);
		expect(survey.status).toBe("draft");
		expect(detail?.questions).toHaveLength(2);
		expect(detail?.questions[0].position).toBe(1);
		expect(detail?.questions[1].position).toBe(2);
		expect(audit).toMatchObject({ action: "survey:create", category: "survey", targetId: survey.id });
	});

	it("rejects create for a non-admin actor", async () => {
		const { repo } = setup();
		await expect(
			repo.create(member, { title: "X", questions: [{ type: "text", prompt: "Q", required: false }] }),
		).rejects.toThrow("Not authorized");
	});

	it("draws a deterministic sample of invited assignments and flips to running", async () => {
		await seedMembers(10);
		const { db, repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });

		const first = await sendCount(repo, survey.id, 4);
		const assignments = await db.select().from(surveyAssignments).where(eq(surveyAssignments.surveyId, survey.id));
		const [running] = await db.select().from(surveys).where(eq(surveys.id, survey.id));

		expect(first).toEqual({ invited: 4, eligible: 11 });
		expect(assignments).toHaveLength(4);
		expect(assignments.every((a) => a.source === "invited")).toBe(true);
		expect(running.status).toBe("running");
		expect(running.sampleSize).toBe(4);
	});

	it("rejects sending a survey that is not draft", async () => {
		await seedMembers(5);
		const { repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await sendCount(repo, survey.id, 2);
		await expect(sendCount(repo, survey.id, 2)).rejects.toThrow("already been sent");
	});

	it("rejects list/get for a non-admin actor", async () => {
		const { repo } = setup();
		await expect(repo.list(member)).rejects.toThrow("Not authorized");
		await expect(repo.getById(member, "srv_x")).rejects.toThrow("Not authorized");
	});

	it("lists the newest forms first, so the cap cuts the oldest", async () => {
		const { repo } = setup();
		const draft = { questions: [{ type: "text" as const, prompt: "Q", required: false }] };
		const older = await repo.create(admin, { title: "Older", ...draft });
		const newer = await repo.create(admin, { title: "Newer", ...draft });
		// Created in the same millisecond is possible, so pin the order the test relies on.
		await env.DB.prepare("UPDATE surveys SET created_at = ? WHERE id = ?").bind(1_000, older.id).run();
		await env.DB.prepare("UPDATE surveys SET created_at = ? WHERE id = ?").bind(2_000, newer.id).run();

		expect((await repo.list(admin)).map((s) => s.title)).toEqual(["Newer", "Older"]);
		expect((await repo.list(admin, { limit: 1 })).map((s) => s.title)).toEqual(["Newer"]);
	});

	it("lets an invited member answer once by session, with no token", async () => {
		await seedMembers(3);
		const { db, repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await sendCount(repo, survey.id, 3);
		const [question] = (await repo.getById(admin, survey.id))!.questions;
		const invited = asMember((await assignedIds(db, survey.id))[0]);

		await expect(
			repo.submitResponse(invited, { surveyId: survey.id, answers: [{ questionId: question.id, value: "ok" }] }, NOW),
		).resolves.toEqual({ ok: true });
		await expect(
			repo.submitResponse(invited, { surveyId: survey.id, answers: [{ questionId: question.id, value: "again" }] }, NOW),
		).rejects.toThrow("You've already answered this form.");

		const responses = await db.select().from(schema.surveyResponses);
		expect(responses).toHaveLength(1);
		expect(responses[0].source).toBe("invited");
		expect(responses[0].memberId).toBe(invited.memberId);
	});

	it("rejects an uninvited member", async () => {
		await seedMembers(3);
		const { db, repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await sendCount(repo, survey.id, 1);
		const [question] = (await repo.getById(admin, survey.id))!.questions;
		const invited = await assignedIds(db, survey.id);
		const outsider = ["mem_admin", "mem_0", "mem_1", "mem_2"].find((id) => !invited.includes(id))!;

		await expect(
			repo.submitResponse(asMember(outsider), { surveyId: survey.id, answers: [{ questionId: question.id, value: "hi" }] }, NOW),
		).rejects.toThrow("This form is not open to you.");
		expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
	});

	it("stores the real submittedAt", async () => {
		await seedMembers(1);
		const { db, repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await sendCount(repo, survey.id, 2);
		const [question] = (await repo.getById(admin, survey.id))!.questions;
		const now = new Date("2026-10-10T15:30:00Z");

		await repo.submitResponse(
			asMember("mem_0"),
			{ surveyId: survey.id, answers: [{ questionId: question.id, value: "ok" }] },
			now,
		);

		const [response] = await db.select().from(schema.surveyResponses);
		expect(response.submittedAt.toISOString()).toBe("2026-10-10T15:30:00.000Z");
	});

	// D1 binds at most 100 parameters per statement; 30 is the schema maximum for both.
	it("creates a 30-question survey and accepts 30 answers to it", async () => {
		await seedMembers(1);
		const { db, repo } = setup();
		const survey = await repo.create(admin, {
			title: "Long",
			questions: Array.from({ length: 30 }, (_, i) => ({ type: "text" as const, prompt: `Q${i + 1}`, required: false })),
		});
		const { questions } = (await repo.getById(admin, survey.id))!;
		expect(questions).toHaveLength(30);
		expect(questions.map((q) => q.position)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

		await sendCount(repo, survey.id, 2);
		await expect(
			repo.submitResponse(
				asMember("mem_0"),
				{ surveyId: survey.id, answers: questions.map((q) => ({ questionId: q.id, value: `A ${q.prompt}` })) },
				NOW,
			),
		).resolves.toEqual({ ok: true });
		expect(await db.select().from(schema.surveyAnswers)).toHaveLength(30);
		expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
	});

	it("lists the three seeded templates in order", async () => {
		const { repo } = setup();
		expect((await repo.listTemplates(admin)).map((t) => t.id)).toEqual(["stpl_standard", "stpl_pulse", "stpl_workshop"]);
		expect((await repo.getTemplate(admin, "stpl_pulse"))?.name).toBe("Quick pulse");
		expect(await repo.getTemplate(admin, "stpl_missing")).toBeNull();
	});

	it("creates an event draft from a template and blocks a second one", async () => {
		await seedEvent();
		const { db, repo } = setup();

		const survey = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });
		const detail = await repo.getById(admin, survey.id);

		expect(survey).toMatchObject({ title: "Feedback: Study Jam", eventId: "evt_1", status: "draft", templateId: "stpl_standard" });
		expect(detail!.questions.map((q) => q.metricKey)).toEqual(["overall", "flow", "content", "venue", "return_intent", null, null]);
		expect(detail!.questions.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(detail!.questions[0].required).toBe(true);
		expect(detail!.questions[1].help).toBe("Was the time enough? Did the order make sense?");
		expect(JSON.parse(detail!.questions[0].optionsJson!)).toEqual(["Very dissatisfied", "Very satisfied"]);
		await expect(repo.getForEvent(admin, "evt_1")).resolves.toMatchObject({ id: survey.id });
		const audits = await db.select().from(schema.auditLogs);
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({ action: "survey:create", category: "survey", targetId: survey.id });

		await expect(repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: "evt_1" })).rejects.toThrow(
			"This event already has a feedback form.",
		);
		expect(await db.select().from(surveys)).toHaveLength(1);
	});

	it("honours an explicit title and names an eventless draft after the template", async () => {
		await seedEvent();
		const { repo } = setup();

		const titled = await repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: "evt_1", title: "My title" });
		const general = await repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: null });
		const another = await repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: null });

		expect(titled.title).toBe("My title");
		expect(general).toMatchObject({ title: "Quick pulse", eventId: null });
		expect(another.id).not.toBe(general.id);
		expect(await repo.getForEvent(admin, "evt_none")).toBeNull();
	});

	it("rejects a missing or soft-deleted event, and a missing or archived template", async () => {
		await seedEvent();
		await seedEvent("evt_gone", "Gone");
		await env.DB.prepare("UPDATE crs_events SET deleted_at = 1 WHERE id = ?").bind("evt_gone").run();
		const { db, repo } = setup();

		await expect(repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: "evt_none" })).rejects.toThrow("Event not found.");
		await expect(repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: "evt_gone" })).rejects.toThrow("Event not found.");
		await expect(repo.createFromTemplate(admin, { templateId: "stpl_nope", eventId: "evt_1" })).rejects.toThrow("Template not found.");
		const custom = await repo.saveTemplate(admin, { name: "Old", description: "", questions: textQuestions(1) });
		await repo.archiveTemplate(admin, custom.id);
		await expect(repo.createFromTemplate(admin, { templateId: custom.id, eventId: "evt_1" })).rejects.toThrow("Template not found.");
		expect(await db.select().from(surveys)).toHaveLength(0);
	});

	it("edits a draft but not a sent form", async () => {
		await seedMembers(3);
		await seedEvent();
		await seedAttendance("evt_1", ["mem_0", "mem_1", "mem_2"]);
		const { db, repo } = setup();
		const survey = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });
		const [oldFirst] = (await repo.getById(admin, survey.id))!.questions;

		await repo.updateDraft(admin, {
			surveyId: survey.id,
			title: "Renamed",
			questions: [
				{ type: "scale", prompt: "Rate it", options: ["Bad", "Good"], required: true, metricKey: "overall" },
				{ type: "text", prompt: "Why?", help: "Be kind", required: false },
			],
		});

		const detail = await repo.getById(admin, survey.id);
		expect(detail!.survey.title).toBe("Renamed");
		expect(detail!.questions.map((q) => [q.position, q.prompt, q.metricKey, q.help])).toEqual([
			[1, "Rate it", "overall", null],
			[2, "Why?", null, "Be kind"],
		]);
		expect(detail!.questions.some((q) => q.id === oldFirst.id)).toBe(false);
		expect(await db.select().from(schema.surveyQuestions)).toHaveLength(2);

		await sendCount(repo, survey.id, 2);
		await expect(repo.updateDraft(admin, { surveyId: survey.id, title: "Late", questions: textQuestions(1) })).rejects.toThrow(
			"Questions can't change after sending.",
		);
		await expect(repo.updateDraft(admin, { surveyId: "srv_missing", title: "X", questions: textQuestions(1) })).rejects.toThrow(
			"Survey not found.",
		);
		const after = await repo.getById(admin, survey.id);
		expect(after!.survey.title).toBe("Renamed");
		expect(after!.questions).toHaveLength(2);
	});

	// 30 questions at 9 columns each is three question inserts, so this proves the chunking.
	it("copies and replaces a 30-question form under the D1 parameter limit", async () => {
		await seedEvent();
		const { repo } = setup();
		const template = await repo.saveTemplate(admin, { name: "Long", description: "", questions: textQuestions(30) });

		const survey = await repo.createFromTemplate(admin, { templateId: template.id, eventId: "evt_1" });
		expect((await repo.getById(admin, survey.id))!.questions).toHaveLength(30);

		await repo.updateDraft(admin, { surveyId: survey.id, title: "Long again", questions: textQuestions(29) });
		const { questions } = (await repo.getById(admin, survey.id))!;
		expect(questions.map((q) => q.position)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
	});

	it("saves and archives a custom template", async () => {
		const { db, repo } = setup();

		const saved = await repo.saveTemplate(admin, {
			name: "Hackathon",
			description: "After a hack night.",
			questions: [{ type: "text", prompt: "What did you build?", required: false }],
		});
		expect(saved).toMatchObject({ name: "Hackathon", createdBy: "mem_admin", archivedAt: null });
		expect(saved.id).toMatch(/^stpl_/);
		expect((await repo.listTemplates(admin)).map((t) => t.id)).toEqual(["stpl_standard", "stpl_pulse", "stpl_workshop", saved.id]);

		const renamed = await repo.saveTemplate(admin, { id: saved.id, name: "Hack night", description: "", questions: textQuestions(2) });
		expect(renamed).toMatchObject({ id: saved.id, name: "Hack night", description: "", position: saved.position });
		expect(renamed.questionsJson).toHaveLength(2);
		await expect(
			repo.saveTemplate(admin, { id: "stpl_nope", name: "X", description: "", questions: textQuestions(1) }),
		).rejects.toThrow("Template not found.");

		await repo.archiveTemplate(admin, saved.id);
		expect((await repo.listTemplates(admin)).map((t) => t.id)).toEqual(["stpl_standard", "stpl_pulse", "stpl_workshop"]);
		expect((await repo.getTemplate(admin, saved.id))?.archivedAt).toBeInstanceOf(Date);
		await expect(repo.archiveTemplate(admin, "stpl_nope")).rejects.toThrow("Template not found.");

		const audits = await db.select().from(schema.auditLogs);
		expect(audits.map((a) => a.action).sort()).toEqual(["survey:template_archive", "survey:template_save", "survey:template_save"]);
		expect(audits.every((a) => a.category === "survey" && a.targetId === saved.id)).toBe(true);
	});

	it("lets the CRS role manage templates and blocks plain members", async () => {
		const { repo } = setup();
		const crs: Actor = { memberId: "mem_admin", roles: ["retention"] };

		await expect(repo.listTemplates(crs)).resolves.toHaveLength(3);
		await expect(repo.listTemplates(member)).rejects.toThrow("Not authorized");
		await expect(repo.getTemplate(member, "stpl_standard")).rejects.toThrow("Not authorized");
		await expect(repo.saveTemplate(member, { name: "X", description: "", questions: textQuestions(1) })).rejects.toThrow(
			"Not authorized",
		);
		await expect(repo.archiveTemplate(member, "stpl_standard")).rejects.toThrow("Not authorized");
		await expect(repo.createFromTemplate(member, { templateId: "stpl_standard", eventId: null })).rejects.toThrow("Not authorized");
		await expect(repo.updateDraft(member, { surveyId: "srv_x", title: "X", questions: textQuestions(1) })).rejects.toThrow(
			"Not authorized",
		);
		await expect(repo.getForEvent(member, "evt_1")).rejects.toThrow("Not authorized");
	});

	describe("send", () => {
		const sendInput = (surveyId: string, extra: Partial<Parameters<SurveysRepository["send"]>[1]> = {}) => ({
			surveyId,
			invite: { mode: "suggested" as const },
			allowWalkIn: true,
			shareWithOrganizers: true,
			emailInvitees: false,
			remind: true,
			closesAt: in72h,
			pointsAward: 0,
			pointTypeId: null,
			...extra,
		});

		async function eventForm(attendees: number) {
			await seedMembers(attendees);
			await seedEvent();
			// mem_admin owns evt_1, so attending it must not make them eligible.
			await seedAttendance("evt_1", ["mem_admin", ...Array.from({ length: attendees }, (_, i) => `mem_${i}`)]);
			const { db, repo } = setup();
			const survey = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });
			return { db, repo, survey };
		}

		it("still sends when a notification write fails after the commit", async () => {
			const { db, survey } = await eventForm(10);
			const noNotices = Object.assign(Object.create(db), {
				insert: (table: Parameters<typeof db.insert>[0]) => {
					if (table === schema.notifications) throw new Error("D1_ERROR: notifications unavailable");
					return db.insert(table);
				},
			}) as typeof db;
			const repo = createSurveysRepository(noNotices, createAuditRepository(noNotices));
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});

			try {
				await expect(repo.send(admin, sendInput(survey.id), NOW)).resolves.toMatchObject({ eligible: 10 });
				const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
				expect(row.status).toBe("running");
				expect(await assignedIds(db, survey.id)).toHaveLength(row.sampleSize ?? -1);
				expect(await db.select().from(schema.notifications)).toHaveLength(0);
				// Logged once, by error type only.
				expect(logged).toHaveBeenCalledTimes(1);
				expect(logged.mock.calls[0][1]).toEqual({ surveyId: survey.id, failed: row.sampleSize, error: "Error" });
			} finally {
				logged.mockRestore();
			}
		});

		it("sends to the suggested sample of eligible attendees and notifies them", async () => {
			const { db, repo, survey } = await eventForm(80);

			const result = await repo.send(admin, sendInput(survey.id), NOW);

			expect(result).toEqual({ invited: 47, eligible: 80 });
			const invited = await assignedIds(db, survey.id);
			expect(invited).toHaveLength(47);
			expect(invited).not.toContain("mem_admin");
			const notes = await db.select().from(schema.notifications);
			expect(notes).toHaveLength(47);
			expect(notes.map((n) => n.memberId).sort()).toEqual([...invited].sort());
			expect(notes[0]).toMatchObject({
				kind: "survey_assigned",
				title: "How was Study Jam?",
				body: "Share quick feedback. Answer to get the other 25% of this event's points.",
				href: `/portal/surveys/${survey.id}`,
			});
			const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
			expect(row).toMatchObject({ status: "running", sampleSize: 47, allowWalkIn: true, shareWithOrganizers: true, emailInvitees: false });
			expect(row.sentAt?.getTime()).toBe(NOW.getTime());
			expect(row.closesAt?.getTime()).toBe(in72h.getTime());
			expect(row.reminderAt?.getTime()).toBe(in72h.getTime() - 24 * HOUR);
			const audits = await db.select().from(schema.auditLogs);
			expect(audits.find((a) => a.action === "survey:send")).toMatchObject({
				category: "survey",
				targetId: survey.id,
				detail: "Invited 47 of 80 eligible.",
			});
		});

		it("invites every eligible attendee in all mode and reports the eligible count", async () => {
			const { repo, survey } = await eventForm(25);

			await expect(repo.eligibleCount(admin, survey.id)).resolves.toBe(25);
			await expect(repo.send(admin, sendInput(survey.id, { invite: { mode: "all" } }), NOW)).resolves.toEqual({
				invited: 25,
				eligible: 25,
			});
		});

		it("skips the reminder when it would land within an hour of sending, or when turned off", async () => {
			const soon = await eventForm(3);
			await soon.repo.send(admin, sendInput(soon.survey.id, { closesAt: new Date(NOW.getTime() + 12 * HOUR) }), NOW);
			const [soonRow] = await soon.db.select().from(surveys).where(eq(surveys.id, soon.survey.id));
			expect(soonRow.reminderAt).toBeNull();

			await env.DB.prepare("DELETE FROM survey_assignments").run();
			await env.DB.prepare("UPDATE surveys SET status = 'draft', reminder_at = NULL").run();
			await soon.repo.send(admin, sendInput(soon.survey.id, { remind: false }), NOW);
			const [offRow] = await soon.db.select().from(surveys).where(eq(surveys.id, soon.survey.id));
			expect(offRow.reminderAt).toBeNull();
		});

		it("refuses to send when nobody is eligible", async () => {
			await seedMembers(2);
			await seedEvent();
			await env.DB.prepare("INSERT INTO event_staff (event_id, member_id, role) VALUES (?, ?, ?)").bind("evt_1", "mem_0", "scanner").run();
			await seedAttendance("evt_1", ["mem_admin", "mem_0"]);
			const { db, repo } = setup();
			const survey = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });

			await expect(repo.eligibleCount(admin, survey.id)).resolves.toBe(0);
			await expect(repo.send(admin, sendInput(survey.id), NOW)).rejects.toThrow("No one is eligible for this form yet.");
			const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
			expect(row.status).toBe("draft");
			expect(await assignedIds(db, survey.id)).toEqual([]);
		});

		it("refuses a closing time in the past", async () => {
			const { db, repo, survey } = await eventForm(3);

			await expect(repo.send(admin, sendInput(survey.id, { closesAt: NOW }), NOW)).rejects.toThrow("Pick a closing time in the future.");
			await expect(
				repo.send(admin, sendInput(survey.id, { closesAt: new Date(NOW.getTime() - HOUR) }), NOW),
			).rejects.toThrow("Pick a closing time in the future.");
			const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
			expect(row.status).toBe("draft");
		});

		it("caps a custom count at the eligible total and never sends twice", async () => {
			const { db, repo, survey } = await eventForm(10);

			await expect(repo.send(admin, sendInput(survey.id, { invite: { mode: "count", count: 500 } }), NOW)).resolves.toEqual({
				invited: 10,
				eligible: 10,
			});
			await expect(repo.send(admin, sendInput(survey.id, { invite: { mode: "count", count: 5 } }), NOW)).rejects.toThrow(
				"already been sent",
			);
			expect(await assignedIds(db, survey.id)).toHaveLength(10);
		});

		it("inserts invitees in chunks under the D1 parameter limit", async () => {
			const { db, repo, survey } = await eventForm(120);

			await expect(repo.send(admin, sendInput(survey.id, { invite: { mode: "all" } }), NOW)).resolves.toEqual({
				invited: 120,
				eligible: 120,
			});
			expect(await assignedIds(db, survey.id)).toHaveLength(120);
		});

		it("forces walk-ins off on a general form", async () => {
			await seedMembers(3);
			const { db, repo } = setup();
			const survey = await repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: null });

			await expect(repo.eligibleCount(admin, survey.id)).resolves.toBe(4);
			await expect(repo.send(admin, sendInput(survey.id, { allowWalkIn: true }), NOW)).resolves.toMatchObject({ eligible: 4 });
			const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
			expect(row.allowWalkIn).toBe(false);
			const notes = await db.select().from(schema.notifications);
			expect(notes.every((n) => n.title === "Quick pulse")).toBe(true);
		});

		it("blocks a plain member and a missing survey", async () => {
			const { repo, survey } = await eventForm(3);

			await expect(repo.send(member, sendInput(survey.id), NOW)).rejects.toThrow("Not authorized");
			await expect(repo.eligibleCount(member, survey.id)).rejects.toThrow("Not authorized");
			await expect(repo.send(admin, sendInput("srv_missing"), NOW)).rejects.toThrow("Survey not found.");
			await expect(repo.eligibleCount(admin, "srv_missing")).rejects.toThrow("Survey not found.");
		});
	});

	describe("updateRunning", () => {
		async function runningForm(extra: Partial<Parameters<SurveysRepository["send"]>[1]> = {}) {
			await seedMembers(5);
			await seedEvent();
			await seedAttendance("evt_1", ["mem_0", "mem_1", "mem_2", "mem_3", "mem_4"]);
			const { db, repo } = setup();
			const survey = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });
			await sendCount(repo, survey.id, 3, extra);
			const row = async () => (await db.select().from(surveys).where(eq(surveys.id, survey.id)))[0];
			return { db, repo, survey, row };
		}

		it("extends a running form and recomputes the reminder", async () => {
			const { db, repo, survey, row } = await runningForm();
			const later = new Date(in72h.getTime() + 48 * HOUR);
			const hourAfterSend = new Date(NOW.getTime() + HOUR);

			await repo.updateRunning(admin, { surveyId: survey.id, closesAt: later, shareWithOrganizers: false }, hourAfterSend);

			const updated = await row();
			expect(updated.closesAt?.getTime()).toBe(later.getTime());
			expect(updated.reminderAt?.getTime()).toBe(later.getTime() - 24 * HOUR);
			expect(updated.shareWithOrganizers).toBe(false);
			expect(updated.status).toBe("running");
			const audits = await db.select().from(schema.auditLogs);
			expect(audits.map((a) => a.action)).toContain("survey:update");
		});

		it("rejects a new closing time that is not in the future", async () => {
			const { repo, survey, row } = await runningForm();

			await expect(repo.updateRunning(admin, { surveyId: survey.id, closesAt: NOW }, NOW)).rejects.toThrow(
				"Pick a closing time in the future.",
			);
			expect((await row()).closesAt?.getTime()).toBe(in72h.getTime());
		});

		it("keeps a reminder that was turned off, off, when the form is extended", async () => {
			const { repo, survey, row } = await runningForm({ remind: false });

			await repo.updateRunning(admin, { surveyId: survey.id, closesAt: new Date(in72h.getTime() + 24 * HOUR) }, NOW);

			expect((await row()).reminderAt).toBeNull();
		});

		it("sends the reminder early only once", async () => {
			const { repo, survey, row } = await runningForm();
			const later = new Date(NOW.getTime() + HOUR);

			await repo.updateRunning(admin, { surveyId: survey.id, remindNow: true }, later);
			expect((await row()).reminderAt?.getTime()).toBe(later.getTime());

			await env.DB.prepare("UPDATE surveys SET reminder_sent_at = ?").bind(later.getTime()).run();
			await expect(repo.updateRunning(admin, { surveyId: survey.id, remindNow: true }, later)).rejects.toThrow(
				"The reminder was already sent.",
			);

			// Once sent, moving the close never schedules a second reminder.
			await repo.updateRunning(admin, { surveyId: survey.id, closesAt: new Date(in72h.getTime() + 48 * HOUR) }, later);
			expect((await row()).reminderAt?.getTime()).toBe(later.getTime());
		});

		it("refuses a reminder once the form has closed", async () => {
			const { repo, survey } = await runningForm();

			await expect(
				repo.updateRunning(admin, { surveyId: survey.id, remindNow: true }, new Date(in72h.getTime() + HOUR)),
			).rejects.toThrow("This form has already closed.");
		});

		it("closes a running form and moves its closing time to now", async () => {
			const { repo, survey, row } = await runningForm();
			const closedAt = new Date(NOW.getTime() + 5 * HOUR);

			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, closedAt);

			const closed = await row();
			expect(closed.status).toBe("closed");
			// Not the planned time 72 hours out: the results read "Closed <when it closed>".
			expect(closed.closesAt?.getTime()).toBe(closedAt.getTime());
		});

		it("keeps the planned closing time when the form had already run past it", async () => {
			const { repo, survey, row } = await runningForm();

			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, new Date(in72h.getTime() + HOUR));

			const closed = await row();
			expect(closed.status).toBe("closed");
			expect(closed.closesAt?.getTime()).toBe(in72h.getTime());
		});

		it("lets sharing be flipped on a closed form but nothing else", async () => {
			const { db, repo, survey, row } = await runningForm();
			const closedAt = new Date(NOW.getTime() + 5 * HOUR);
			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, closedAt);

			await repo.updateRunning(admin, { surveyId: survey.id, shareWithOrganizers: false }, closedAt);
			expect((await row()).shareWithOrganizers).toBe(false);
			await repo.updateRunning(admin, { surveyId: survey.id, shareWithOrganizers: true }, closedAt);
			expect((await row()).shareWithOrganizers).toBe(true);
			const audits = await db.select().from(schema.auditLogs);
			expect(audits.some((audit) => audit.detail === "organizer sharing off")).toBe(true);

			// The closing date, a reminder and a second close are still refused, and a refused call changes nothing.
			const later = new Date(closedAt.getTime() + 48 * HOUR);
			for (const change of [{ closesAt: later }, { remindNow: true as const }, { close: true as const }]) {
				await expect(repo.updateRunning(admin, { surveyId: survey.id, ...change }, closedAt)).rejects.toThrow(
					"Only a running form can be edited.",
				);
			}
			await expect(
				repo.updateRunning(admin, { surveyId: survey.id, closesAt: later, shareWithOrganizers: false }, closedAt),
			).rejects.toThrow("Only a running form can be edited.");
			const after = await row();
			expect(after.closesAt?.getTime()).toBe(closedAt.getTime());
			expect(after.shareWithOrganizers).toBe(true);
			expect(after.status).toBe("closed");
		});

		it("does not let a plain member flip sharing on a closed form", async () => {
			const { repo, survey } = await runningForm();
			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, NOW);

			await expect(repo.updateRunning(member, { surveyId: survey.id, shareWithOrganizers: false }, NOW)).rejects.toThrow("Not authorized");
		});

		it("refuses a draft, a missing survey and a plain member", async () => {
			await seedEvent();
			const { repo } = setup();
			const draft = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });

			await expect(repo.updateRunning(admin, { surveyId: draft.id, close: true }, NOW)).rejects.toThrow(
				"Only a running form can be edited.",
			);
			// Sharing on a draft is chosen when it is sent, not before.
			await expect(repo.updateRunning(admin, { surveyId: draft.id, shareWithOrganizers: false }, NOW)).rejects.toThrow(
				"Only a running form can be edited.",
			);
			await expect(repo.updateRunning(admin, { surveyId: "srv_missing", close: true }, NOW)).rejects.toThrow("Survey not found.");
			await expect(repo.updateRunning(member, { surveyId: draft.id, close: true }, NOW)).rejects.toThrow("Not authorized");
		});
	});

	describe("answering", () => {
		const LATE = new Date("2026-10-16T17:30:00.000Z"); // 01:30 on the 17th in Manila, before the form closes

		// mem_0..mem_3 attended evt_1 (owned by mem_admin); exactly one of them is invited, another walks in.
		async function eventForm(extra: Partial<Parameters<SurveysRepository["send"]>[1]> = {}) {
			await seedMembers(4);
			await seedEvent();
			await seedAttendance("evt_1", ["mem_0", "mem_1", "mem_2", "mem_3"]);
			const { db, repo } = setup();
			const survey = await repo.create(admin, {
				title: "Study Jam feedback",
				eventId: "evt_1",
				questions: [
					{ type: "scale", prompt: "Overall", options: ["Bad", "Good"], required: true },
					{ type: "choice", prompt: "Pick one", options: ["Red", "Blue"], required: false },
					{ type: "text", prompt: "Why?", required: false },
				],
			});
			await sendCount(repo, survey.id, 1, extra);
			const invitedId = (await assignedIds(db, survey.id))[0];
			const walkInId = ["mem_0", "mem_1", "mem_2", "mem_3"].find((id) => id !== invitedId)!;
			const [overall, pick, why] = (await repo.getById(admin, survey.id))!.questions;
			const answer = (value = "4") => ({ surveyId: survey.id, answers: [{ questionId: overall.id, value }] });
			return { db, repo, survey, overall, pick, why, answer, invited: asMember(invitedId), walkIn: asMember(walkInId) };
		}

		it("lets a non-invited attendee answer as a walk-in once", async () => {
			const { db, repo, survey, answer, walkIn } = await eventForm();

			const before = await repo.getForRespondent(walkIn, survey.id, LATE);
			expect(before).toMatchObject({ state: "open", eventTitle: "Study Jam" });
			expect(before!.questions).toHaveLength(3);

			await expect(repo.submitResponse(walkIn, answer("5"), LATE)).resolves.toEqual({ ok: true });

			const [response] = await db.select().from(schema.surveyResponses);
			const [assignment] = await db.select().from(surveyAssignments).where(eq(surveyAssignments.memberId, walkIn.memberId));
			expect(response.source).toBe("walk_in");
			expect(response.memberId).toBe(walkIn.memberId);
			expect(assignment).toMatchObject({ surveyId: survey.id, source: "walk_in" });
			expect(assignment.completedAt?.getTime()).toBe(LATE.getTime());
			expect(await db.select().from(schema.surveyAnswers)).toHaveLength(1);
			expect((await repo.getForRespondent(walkIn, survey.id, LATE))!.state).toBe("answered");

			await expect(repo.submitResponse(walkIn, answer("5"), LATE)).rejects.toThrow("You've already answered this form.");
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
			expect(await db.select().from(schema.surveyAnswers)).toHaveLength(1);
		});

		it("maps a lost walk-in race to already answered and leaves no response behind", async () => {
			const { db, survey, answer, walkIn } = await eventForm();
			// A second tab's submit lands between this one's eligibility check and its write.
			const racing = Object.assign(Object.create(db), {
				batch: async (queries: Parameters<typeof db.batch>[0]) => {
					await env.DB.prepare(
						"INSERT INTO survey_assignments (survey_id, member_id, assigned_at, completed_at, source) VALUES (?, ?, ?, ?, ?)",
					)
						.bind(survey.id, walkIn.memberId, 0, 0, "walk_in")
						.run();
					return db.batch(queries);
				},
			}) as typeof db;
			const repo = createSurveysRepository(racing, createAuditRepository(racing));

			await expect(repo.submitResponse(walkIn, answer(), LATE)).rejects.toThrow("You've already answered this form.");
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
			expect(await db.select().from(schema.surveyAnswers)).toHaveLength(0);
		});

		it("releases an invitee's claim when the response write fails, so a retry can answer", async () => {
			const { db, repo, answer, invited } = await eventForm();
			const failing = Object.assign(Object.create(db), {
				batch: async () => {
					throw new Error("D1_ERROR: write failed");
				},
			}) as typeof db;
			const flaky = createSurveysRepository(failing, createAuditRepository(failing));

			await expect(flaky.submitResponse(invited, answer(), LATE)).rejects.toThrow("D1_ERROR: write failed");
			const [assignment] = await db.select().from(surveyAssignments).where(eq(surveyAssignments.memberId, invited.memberId));
			expect(assignment.completedAt).toBeNull();
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);

			await expect(repo.submitResponse(invited, answer(), LATE)).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
		});

		it("stores a walk-in response's real submittedAt", async () => {
			const { db, repo, answer, walkIn } = await eventForm();

			await repo.submitResponse(walkIn, answer(), LATE);

			const [response] = await db.select().from(schema.surveyResponses);
			expect(response.submittedAt.getTime()).toBe(LATE.getTime());
		});

		it("lets an invited member of an event form answer and then reads answered", async () => {
			const { db, repo, survey, answer, invited } = await eventForm();

			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("open");
			await repo.submitResponse(invited, answer(), LATE);

			const [response] = await db.select().from(schema.surveyResponses);
			expect(response.source).toBe("invited");
			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("answered");
			await expect(repo.submitResponse(invited, answer(), LATE)).rejects.toThrow("You've already answered this form.");
		});

		it("lets every attendee answer an event's form, even with walk-ins turned off", async () => {
			// Answering pays the rest of the event's points, so no attendee may be shut out by the sample.
			const { repo, survey, answer, walkIn, invited } = await eventForm({ allowWalkIn: false });

			expect((await repo.getForRespondent(walkIn, survey.id, LATE))!.state).toBe("open");
			await expect(repo.submitResponse(walkIn, answer(), LATE)).resolves.toEqual({ ok: true });
			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("open");
		});

		it("keeps a non-attendee out and shows them none of the questions", async () => {
			const { repo, survey, answer } = await eventForm();
			await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
				.bind("mem_out", "out@example.com", "Out", "active")
				.run();
			const outsider = asMember("mem_out");

			const view = await repo.getForRespondent(outsider, survey.id, LATE);
			expect(view).toMatchObject({ state: "ineligible", questions: [] });
			await expect(repo.submitResponse(outsider, answer(), LATE)).rejects.toThrow("This form is not open to you.");
		});

		it("rejects a member who became staff after sending", async () => {
			const { db, repo, survey, answer, invited } = await eventForm();
			await env.DB.prepare("INSERT INTO event_staff (event_id, member_id, role) VALUES (?, ?, ?)")
				.bind("evt_1", invited.memberId, "scanner")
				.run();

			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("staff");
			await expect(repo.submitResponse(invited, answer(), LATE)).rejects.toThrow("Organizers give feedback through the debrief.");
			// The event owner is staff too.
			expect((await repo.getForRespondent(admin, survey.id, LATE))!.state).toBe("staff");
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
		});

		it("treats a soft-deleted event's form as closed", async () => {
			const { repo, survey, answer, invited, walkIn } = await eventForm();
			await env.DB.prepare("UPDATE crs_events SET deleted_at = 1 WHERE id = ?").bind("evt_1").run();

			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("closed");
			expect((await repo.getForRespondent(walkIn, survey.id, LATE))!.state).toBe("closed");
			await expect(repo.submitResponse(walkIn, answer(), LATE)).rejects.toThrow("This form has closed.");
			await expect(repo.openFeedbackForEvent(walkIn, "evt_1", LATE)).resolves.toBeNull();
		});

		it("rejects after closesAt or once an admin closes the form", async () => {
			const { repo, survey, answer, invited, walkIn } = await eventForm();
			const afterClose = new Date(in72h.getTime() + HOUR);

			expect((await repo.getForRespondent(invited, survey.id, afterClose))!.state).toBe("closed");
			await expect(repo.submitResponse(invited, answer(), afterClose)).rejects.toThrow("This form has closed.");
			await expect(repo.submitResponse(walkIn, answer(), afterClose)).rejects.toThrow("This form has closed.");

			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, LATE);
			expect((await repo.getForRespondent(invited, survey.id, LATE))!.state).toBe("closed");
			await expect(repo.submitResponse(invited, answer(), LATE)).rejects.toThrow("This form has closed.");
		});

		it("hides a draft or missing form and refuses to answer it", async () => {
			await seedMembers(2);
			await seedEvent();
			await seedAttendance("evt_1", ["mem_0", "mem_1"]);
			const { db, repo } = setup();
			const draft = await repo.create(admin, {
				title: "Draft",
				eventId: "evt_1",
				questions: [{ type: "text", prompt: "Q", required: false }],
			});
			const [question] = (await repo.getById(admin, draft.id))!.questions;
			const input = { surveyId: draft.id, answers: [{ questionId: question.id, value: "hi" }] };

			expect(await repo.getForRespondent(asMember("mem_0"), draft.id, LATE)).toBeNull();
			expect(await repo.getForRespondent(asMember("mem_0"), "srv_missing", LATE)).toBeNull();
			await expect(repo.submitResponse(asMember("mem_0"), input, LATE)).rejects.toThrow("This form is not open to you.");
			await expect(repo.submitResponse(asMember("mem_0"), { ...input, surveyId: "srv_missing" }, LATE)).rejects.toThrow(
				"This form is not open to you.",
			);
			await expect(repo.openFeedbackForEvent(asMember("mem_0"), "evt_1", LATE)).resolves.toBeNull();
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
		});

		it("requires required answers and valid values", async () => {
			const { db, repo, survey, pick, why, answer, walkIn } = await eventForm();
			const submit = (answers: Array<{ questionId: string; value: string }>) =>
				repo.submitResponse(walkIn, { surveyId: survey.id, answers }, LATE);

			await expect(submit([{ questionId: why.id, value: "only text" }])).rejects.toThrow("Answer every required question.");
			await expect(submit(answer("6").answers)).rejects.toThrow("Pick a value from 1 to 5.");
			await expect(submit(answer("0").answers)).rejects.toThrow("Pick a value from 1 to 5.");
			await expect(submit(answer("3.5").answers)).rejects.toThrow("Pick a value from 1 to 5.");
			await expect(submit([...answer("4").answers, { questionId: pick.id, value: "Green" }])).rejects.toThrow(
				"Pick one of the listed choices.",
			);
			await expect(submit([...answer("4").answers, { questionId: "srvq_other", value: "x" }])).rejects.toThrow(
				"Answer references an unknown question.",
			);
			await expect(submit([...answer("4").answers, ...answer("5").answers])).rejects.toThrow("Answer each question once.");

			// Nothing was written, so the walk-in can still answer properly.
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
			expect(await db.select().from(surveyAssignments).where(eq(surveyAssignments.memberId, walkIn.memberId))).toHaveLength(0);
			await expect(
				submit([...answer("1").answers, { questionId: pick.id, value: "Blue" }, { questionId: why.id, value: "ok" }]),
			).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.surveyAnswers)).toHaveLength(3);
		});

		it("does not claim an invitee's slot when their answers are invalid", async () => {
			const { db, repo, survey, answer, invited } = await eventForm();

			await expect(repo.submitResponse(invited, answer("9"), LATE)).rejects.toThrow("Pick a value from 1 to 5.");
			const [pending] = await db.select().from(surveyAssignments).where(eq(surveyAssignments.memberId, invited.memberId));
			expect(pending.completedAt).toBeNull();

			await expect(repo.submitResponse(invited, answer("2"), LATE)).resolves.toEqual({ ok: true });
			const [done] = await db.select().from(surveyAssignments).where(eq(surveyAssignments.memberId, invited.memberId));
			expect(done).toMatchObject({ surveyId: survey.id, source: "invited" });
			expect(done.completedAt).not.toBeNull();
		});

		it("shows the event card only to eligible attendees", async () => {
			const { repo, survey, answer, walkIn, invited } = await eventForm();
			await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
				.bind("mem_out", "out@example.com", "Out", "active")
				.run();

			await expect(repo.openFeedbackForEvent(walkIn, "evt_1", LATE)).resolves.toEqual({ surveyId: survey.id, state: "open" });
			await expect(repo.openFeedbackForEvent(invited, "evt_1", LATE)).resolves.toEqual({ surveyId: survey.id, state: "open" });
			await repo.submitResponse(walkIn, answer(), LATE);
			await expect(repo.openFeedbackForEvent(walkIn, "evt_1", LATE)).resolves.toEqual({ surveyId: survey.id, state: "answered" });

			await expect(repo.openFeedbackForEvent(asMember("mem_out"), "evt_1", LATE)).resolves.toBeNull();
			await expect(repo.openFeedbackForEvent(admin, "evt_1", LATE)).resolves.toBeNull();
			await expect(repo.openFeedbackForEvent(walkIn, "evt_none", LATE)).resolves.toBeNull();
			await expect(repo.openFeedbackForEvent(walkIn, "evt_1", new Date(in72h.getTime() + HOUR))).resolves.toBeNull();
		});

		it("answers a general form by invitation only", async () => {
			await seedMembers(3);
			const { db, repo } = setup();
			const survey = await repo.create(admin, { title: "General", questions: [{ type: "text", prompt: "Q", required: true }] });
			await sendCount(repo, survey.id, 1);
			const [question] = (await repo.getById(admin, survey.id))!.questions;
			const input = { surveyId: survey.id, answers: [{ questionId: question.id, value: "hi" }] };
			const invitedId = (await assignedIds(db, survey.id))[0];
			const outsider = asMember(["mem_0", "mem_1", "mem_2"].find((id) => id !== invitedId)!);

			expect(await repo.getForRespondent(outsider, survey.id, LATE)).toMatchObject({ state: "ineligible", eventTitle: null });
			await expect(repo.submitResponse(outsider, input, LATE)).rejects.toThrow("This form is not open to you.");
			await expect(repo.submitResponse(asMember(invitedId), input, LATE)).resolves.toEqual({ ok: true });
		});

		it("saves a 30-answer walk-in response under the D1 parameter limit", async () => {
			await seedMembers(2);
			await seedEvent();
			await seedAttendance("evt_1", ["mem_0", "mem_1"]);
			const { db, repo } = setup();
			const survey = await repo.create(admin, { title: "Long", eventId: "evt_1", questions: textQuestions(30) });
			await sendCount(repo, survey.id, 1);
			const invitedId = (await assignedIds(db, survey.id))[0];
			const walkIn = asMember(["mem_0", "mem_1"].find((id) => id !== invitedId)!);
			const { questions } = (await repo.getById(admin, survey.id))!;

			await expect(
				repo.submitResponse(walkIn, { surveyId: survey.id, answers: questions.map((q) => ({ questionId: q.id, value: q.prompt })) }, LATE),
			).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.surveyAnswers)).toHaveLength(30);
		});
	});

	describe("points for answering", () => {
		// The check-ins fall in term A; the form is answered in term B.
		const CHECKED_IN = new Date("2026-10-15T10:00:00.000Z");
		const ANSWERED = new Date("2026-10-17T00:00:00.000Z");
		const TERMS = [
			{ id: "term_a", name: "A", startsAt: new Date("2026-06-01T00:00:00Z"), endsAt: new Date("2026-10-16T12:00:00Z") },
			{ id: "term_b", name: "B", startsAt: new Date("2026-10-16T12:00:01Z"), endsAt: new Date("2027-03-31T00:00:00Z") },
		];
		const setActive = (active: boolean) => env.DB.prepare("UPDATE point_types SET active = ? WHERE id = 'pt_feedback'").bind(active ? 1 : 0).run();

		beforeEach(async () => {
			await env.DB.prepare("DELETE FROM retention_records").run();
			await env.DB.prepare("DELETE FROM terms").run();
			await env.DB.prepare("DELETE FROM notifications").run();
			await setActive(true);
			await setup().db.insert(schema.terms).values(TERMS);
		});

		// mem_0..mem_2 checked in to evt_1 (unless eventId is null); one is invited, the others can walk in.
		async function pointsForm(options: { eventId?: string | null; pointsAward?: number; pointTypeId?: string | null } = {}) {
			await seedMembers(3);
			const eventId = options.eventId === undefined ? "evt_1" : options.eventId;
			if (eventId) {
				await seedEvent(eventId);
				await env.DB.batch(
					["mem_0", "mem_1", "mem_2"].map((memberId) =>
						env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)").bind(
							eventId,
							memberId,
							CHECKED_IN.getTime(),
							"mem_admin",
						),
					),
				);
			}
			const { db, repo } = setup();
			const survey = await repo.create(admin, { title: "General", eventId, questions: [{ type: "text", prompt: "Q", required: false }] });
			await sendCount(repo, survey.id, 1, { pointsAward: options.pointsAward ?? 1.5, pointTypeId: options.pointTypeId ?? "pt_feedback" });
			const [question] = (await repo.getById(admin, survey.id))!.questions;
			const answer = (value: string) => ({ surveyId: survey.id, answers: [{ questionId: question.id, value }] });
			const invitedId = (await assignedIds(db, survey.id))[0];
			const walkIn = asMember(["mem_0", "mem_1", "mem_2"].find((id) => id !== invitedId)!);
			return { db, repo, survey, answer, invited: asMember(invitedId), walkIn };
		}

		it("gives a new draft 1 Feedback point, or none while that type is retired", async () => {
			const { repo } = setup();
			expect(await repo.create(admin, { title: "S", questions: textQuestions(1) })).toMatchObject({ pointsAward: 1, pointTypeId: "pt_feedback" });

			await setActive(false);
			expect(await repo.createFromTemplate(admin, { templateId: "stpl_pulse", eventId: null })).toMatchObject({ pointsAward: 0, pointTypeId: null });
		});

		it("stores the points on send, says so in the notice, and refuses a point type that is not active", async () => {
			await seedMembers(2);
			const { db, repo } = setup();
			const survey = await repo.create(admin, { title: "S", questions: textQuestions(1) });

			await expect(sendCount(repo, survey.id, 1, { pointsAward: 1, pointTypeId: "pt_missing" })).rejects.toThrow("Pick an active point type for answering.");
			await setActive(false);
			await expect(sendCount(repo, survey.id, 1, { pointsAward: 1, pointTypeId: "pt_feedback" })).rejects.toThrow("Pick an active point type for answering.");
			await setActive(true);

			await sendCount(repo, survey.id, 1, { pointsAward: 0.75, pointTypeId: "pt_feedback" });
			const [row] = await db.select().from(surveys).where(eq(surveys.id, survey.id));
			expect(row).toMatchObject({ status: "running", pointsAward: 0.75, pointTypeId: "pt_feedback" });
			const [note] = await db.select().from(schema.notifications);
			expect(note.body).toBe("Share quick feedback. You'll get 0.75 Feedback points for answering.");

			// 0 turns points off, so no point type is kept, whatever the picker showed.
			const off = await repo.create(admin, { title: "Off", questions: textQuestions(1) });
			await sendCount(repo, off.id, 1, { pointsAward: 0, pointTypeId: "pt_missing" });
			const [offRow] = await db.select().from(surveys).where(eq(surveys.id, off.id));
			expect(offRow).toMatchObject({ pointsAward: 0, pointTypeId: null });
		});

		it("awards an invitee once, recorded by the form's creator, on a form with no event", async () => {
			const { db, repo, answer, invited } = await pointsForm({ eventId: null });

			await repo.submitResponse(invited, answer("Loved it"), ANSWERED);
			await expect(repo.submitResponse(invited, answer("Again"), ANSWERED)).rejects.toThrow("You've already answered this form.");

			const records = await db.select().from(schema.retentionRecords);
			expect(records).toHaveLength(1);
			expect(records[0]).toMatchObject({
				memberId: invited.memberId,
				eventId: null,
				pointTypeId: "pt_feedback",
				points: 1.5,
				source: "survey_response",
				recordedBy: "mem_admin",
			});
			expect(records[0].recordedAt.getTime()).toBe(ANSWERED.getTime());
		});

		it("gives no points for answering on an event's form: it pays the rest of the event's points instead", async () => {
			// evt_1 awards no points here, so there is no share either; feedback-share.integration.test.ts covers the share.
			const { db, repo, answer, invited, walkIn } = await pointsForm();

			await repo.submitResponse(invited, answer("Great"), ANSWERED);
			await repo.submitResponse(walkIn, answer("Terrible, honestly"), ANSWERED);

			expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);
			const [row] = await db.select().from(surveys);
			expect(row).toMatchObject({ pointsAward: 0, pointTypeId: null });
		});

		it("awards nothing when the form gives 0 points", async () => {
			const { db, repo, answer, invited } = await pointsForm({ pointsAward: 0, pointTypeId: null });

			await expect(repo.submitResponse(invited, answer("ok"), ANSWERED)).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
			expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);
		});

		it("uses the time of answering and the form title for a form with no event", async () => {
			const { db, repo, answer, invited } = await pointsForm({ eventId: null });

			await repo.submitResponse(invited, answer("ok"), ANSWERED);

			const [record] = await db.select().from(schema.retentionRecords);
			expect(record).toMatchObject({ termId: "term_b", eventId: null, reason: "Answered the feedback form for General" });
		});

		it("keeps the answer but skips a second award for the same event", async () => {
			const { db, repo, answer, invited } = await pointsForm();
			// Points from an earlier form for the same event, since deleted.
			await db.insert(schema.retentionRecords).values({
				id: "ret_old",
				memberId: invited.memberId,
				termId: "term_a",
				eventId: "evt_1",
				pointTypeId: "pt_feedback",
				points: 1,
				reason: "Answered the feedback form for Study Jam",
				source: "survey_response",
				recordedBy: "mem_admin",
			});

			await expect(repo.submitResponse(invited, answer("ok"), ANSWERED)).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
			expect((await db.select().from(schema.retentionRecords)).map((record) => record.id)).toEqual(["ret_old"]);
		});

		it("still takes the answer when no term covers it", async () => {
			const { db, repo, answer, invited } = await pointsForm({ eventId: null });
			await env.DB.prepare("DELETE FROM terms").run();

			await expect(repo.submitResponse(invited, answer("ok"), ANSWERED)).resolves.toEqual({ ok: true });
			expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);
		});
	});
});
