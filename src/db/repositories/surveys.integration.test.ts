import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { surveyAssignments, surveys } from "@/db/schema";
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
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));

		const survey = await repo.create(admin, {
			title: "Practice Night Feedback",
			questions: [
				{ type: "scale", prompt: "How useful was it?", options: ["1", "2", "3", "4", "5"] },
				{ type: "text", prompt: "Anything to add?" },
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
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		await expect(repo.create(member, { title: "X", questions: [{ type: "text", prompt: "Q" }] })).rejects.toThrow(
			"Not authorized",
		);
	});

	it("draws a deterministic sample, stores only token hashes, and flips to running", async () => {
		await seedMembers(10);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });

		const first = await repo.sample(admin, { surveyId: survey.id, sampleSize: 4, seed: "fixed" });
		const assignments = await db.select().from(surveyAssignments).where(eq(surveyAssignments.surveyId, survey.id));
		const [running] = await db.select().from(surveys).where(eq(surveys.id, survey.id));

		expect(first.assigned).toBe(4);
		expect(first.tokens).toHaveLength(4);
		expect(assignments).toHaveLength(4);
		const hashes = new Set(assignments.map((a) => a.responseTokenHash));
		expect(first.tokens.every((t) => !hashes.has(t.token))).toBe(true);
		expect(running.status).toBe("running");
		expect(running.sampleSize).toBe(4);
	});

	it("rejects sampling a survey that is not draft", async () => {
		await seedMembers(5);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" });
		await expect(repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" })).rejects.toThrow(
			"already been sampled",
		);
	});

	it("rejects list/get for a non-admin actor", async () => {
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		await expect(repo.list(member)).rejects.toThrow("Not authorized");
		await expect(repo.getById(member, "srv_x")).rejects.toThrow("Not authorized");
	});

	it("accepts a valid token once, stores no member link, then rejects reuse", async () => {
		await seedMembers(3);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, {
			title: "S",
			questions: [{ type: "scale", prompt: "Rate", options: ["1", "2"] }],
		});
		const detail = await repo.getById(admin, survey.id);
		const questionId = detail!.questions[0].id;
		const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "fixed" });
		const token = tokens[0].token;

		await expect(
			repo.submitResponse({ surveyId: survey.id, token, answers: [{ questionId, value: "2" }] }),
		).resolves.toEqual({ ok: true });

		const [response] = await db.select().from(schema.surveyResponses);
		expect(Object.keys(response)).toEqual(expect.arrayContaining(["id", "surveyId", "submittedAt"]));
		expect(Object.keys(response)).not.toContain("memberId");
		await expect(
			repo.submitResponse({ surveyId: survey.id, token, answers: [{ questionId, value: "1" }] }),
		).rejects.toThrow("already been used");
	});

	it("rejects an unknown or wrong-survey token", async () => {
		await seedMembers(2);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		const detail = await repo.getById(admin, survey.id);
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "x" });
		await expect(
			repo.submitResponse({
				surveyId: survey.id,
				token: "not-a-real-token",
				answers: [{ questionId: detail!.questions[0].id, value: "hi" }],
			}),
		).rejects.toThrow("already been used");
	});

	it("aggregates identity-free results with assigned and completed counts", async () => {
		await seedMembers(3);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, {
			title: "S",
			questions: [
				{ type: "scale", prompt: "Rate", options: ["1", "2", "3"] },
				{ type: "text", prompt: "Why?" },
			],
		});
		const detail = await repo.getById(admin, survey.id);
		const [scaleQ, textQ] = detail!.questions;
		const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "x" });
		await repo.submitResponse({
			surveyId: survey.id,
			token: tokens[0].token,
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
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		await expect(repo.getResults(member, survey.id)).rejects.toThrow("Not authorized");
	});
});
