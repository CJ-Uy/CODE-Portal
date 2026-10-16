import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { surveyAssignments, surveys } from "@/db/schema";
import { startOfUtc8Day } from "@/lib/date-slots";
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

	it("lets an invited member answer once by session, with no token", async () => {
		await seedMembers(3);
		const { db, repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await sendCount(repo, survey.id, 3);
		const [question] = (await repo.getById(admin, survey.id))!.questions;
		const invited = asMember((await assignedIds(db, survey.id))[0]);

		await expect(
			repo.submitResponse(invited, { surveyId: survey.id, answers: [{ questionId: question.id, value: "ok" }] }),
		).resolves.toEqual({ ok: true });
		await expect(
			repo.submitResponse(invited, { surveyId: survey.id, answers: [{ questionId: question.id, value: "again" }] }),
		).rejects.toThrow("already");

		const responses = await db.select().from(schema.surveyResponses);
		expect(responses).toHaveLength(1);
		expect(responses[0].source).toBe("invited");
		expect(Object.keys(responses[0])).not.toContain("memberId");
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
			repo.submitResponse(asMember(outsider), { surveyId: survey.id, answers: [{ questionId: question.id, value: "hi" }] }),
		).rejects.toThrow("not open to you");
		expect(await db.select().from(schema.surveyResponses)).toHaveLength(0);
	});

	it("stores submittedAt truncated to the Manila day", async () => {
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
		expect(response.submittedAt.getTime()).toBe(startOfUtc8Day(now).getTime());
		expect(response.submittedAt.toISOString()).toBe("2026-10-09T16:00:00.000Z");
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
			repo.submitResponse(asMember("mem_0"), {
				surveyId: survey.id,
				answers: questions.map((q) => ({ questionId: q.id, value: `A ${q.prompt}` })),
			}),
		).resolves.toEqual({ ok: true });
		expect(await db.select().from(schema.surveyAnswers)).toHaveLength(30);
		expect(await db.select().from(schema.surveyResponses)).toHaveLength(1);
	});

	it("aggregates identity-free results with assigned and completed counts", async () => {
		await seedMembers(3);
		const { db, repo } = setup();
		const survey = await repo.create(admin, {
			title: "S",
			questions: [
				{ type: "scale", prompt: "Rate", options: ["Low", "High"], required: true },
				{ type: "text", prompt: "Why?", required: false },
			],
		});
		const detail = await repo.getById(admin, survey.id);
		const [scaleQ, textQ] = detail!.questions;
		await sendCount(repo, survey.id, 2, { seed: "x" });
		await repo.submitResponse(asMember((await assignedIds(db, survey.id))[0]), {
			surveyId: survey.id,
			answers: [
				{ questionId: scaleQ.id, value: "3" },
				{ questionId: textQ.id, value: "Great session" },
			],
		});

		const results = await repo.getResults(admin, survey.id);
		expect(results.assignedCount).toBe(2);
		expect(results.completedCount).toBe(1);
		const scaleResult = results.questions.find((q) => q.questionId === scaleQ.id);
		expect(scaleResult?.valueCounts).toEqual({ "3": 1 });
		const textResult = results.questions.find((q) => q.questionId === textQ.id);
		expect(textResult?.textAnswers).toEqual(["Great session"]);
	});

	it("rejects getResults for a non-admin actor", async () => {
		const { repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await expect(repo.getResults(member, survey.id)).rejects.toThrow("Not authorized");
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
				body: "Share quick feedback. Your name isn't attached to your answers.",
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

		it("closes a running form and edits nothing else once closed", async () => {
			const { repo, survey, row } = await runningForm();

			await repo.updateRunning(admin, { surveyId: survey.id, close: true }, NOW);

			expect((await row()).status).toBe("closed");
			await expect(repo.updateRunning(admin, { surveyId: survey.id, shareWithOrganizers: false }, NOW)).rejects.toThrow(
				"Only a running form can be edited.",
			);
		});

		it("refuses a draft, a missing survey and a plain member", async () => {
			await seedEvent();
			const { repo } = setup();
			const draft = await repo.createFromTemplate(admin, { templateId: "stpl_standard", eventId: "evt_1" });

			await expect(repo.updateRunning(admin, { surveyId: draft.id, close: true }, NOW)).rejects.toThrow(
				"Only a running form can be edited.",
			);
			await expect(repo.updateRunning(admin, { surveyId: "srv_missing", close: true }, NOW)).rejects.toThrow("Survey not found.");
			await expect(repo.updateRunning(member, { surveyId: draft.id, close: true }, NOW)).rejects.toThrow("Not authorized");
		});
	});
});
