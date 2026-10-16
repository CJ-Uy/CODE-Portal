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

describe("surveys repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM survey_answers").run();
		await env.DB.prepare("DELETE FROM survey_responses").run();
		await env.DB.prepare("DELETE FROM survey_assignments").run();
		await env.DB.prepare("DELETE FROM survey_questions").run();
		await env.DB.prepare("DELETE FROM surveys").run();
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
});
