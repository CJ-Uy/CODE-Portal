import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { surveyAssignments, surveys } from "@/db/schema";
import { startOfUtc8Day } from "@/lib/date-slots";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createSurveysRepository } from "./surveys";

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

		const first = await repo.sample(admin, { surveyId: survey.id, sampleSize: 4, seed: "fixed" });
		const assignments = await db.select().from(surveyAssignments).where(eq(surveyAssignments.surveyId, survey.id));
		const [running] = await db.select().from(surveys).where(eq(surveys.id, survey.id));

		expect(first).toEqual({ assigned: 4 });
		expect(assignments).toHaveLength(4);
		expect(assignments.every((a) => a.source === "invited")).toBe(true);
		expect(running.status).toBe("running");
		expect(running.sampleSize).toBe(4);
	});

	it("rejects sampling a survey that is not draft", async () => {
		await seedMembers(5);
		const { repo } = setup();
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q", required: false }] });
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" });
		await expect(repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" })).rejects.toThrow(
			"already been sampled",
		);
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
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 3, seed: "fixed" });
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
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "fixed" });
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
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "fixed" });
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

		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "fixed" });
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
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "x" });
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

		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "fixed" });
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
});
