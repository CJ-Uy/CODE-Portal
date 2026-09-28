import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createAuditRepository } from "@/db/repositories/audit";
import { createSurveysRepository, type SurveysRepository } from "@/db/repositories/surveys";
import type { Actor } from "@/server/auth/permissions";
import { POST } from "./route";

const admin: Actor = { memberId: "mem_admin", roles: ["super"] };
const ORIGIN = "https://portal.example.com";
const testState = vi.hoisted(() => ({ repositories: null as null | { surveys: SurveysRepository } }));

vi.mock("@/db", () => ({
	getRepositories: async () => {
		if (!testState.repositories) throw new Error("Test repositories not initialized.");
		return testState.repositories;
	},
}));

async function setupRunningSurvey() {
	await env.DB.prepare("DELETE FROM survey_answers").run();
	await env.DB.prepare("DELETE FROM survey_responses").run();
	await env.DB.prepare("DELETE FROM survey_assignments").run();
	await env.DB.prepare("DELETE FROM survey_questions").run();
	await env.DB.prepare("DELETE FROM surveys").run();
	await env.DB.prepare("DELETE FROM members").run();
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin", "active")
		.run();
	for (let i = 0; i < 3; i += 1) {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind(`mem_${i}`, `m${i}@example.com`, `M${i}`, "active")
			.run();
	}
	const db = drizzle(env.DB, { schema });
	const repo = createSurveysRepository(db, createAuditRepository(db));
	testState.repositories = { surveys: repo };
	const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
	const detail = await repo.getById(admin, survey.id);
	const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "x" });
	return { surveyId: survey.id, questionId: detail!.questions[0].id, token: tokens[0].token };
}

describe("POST /api/surveys/submit", () => {
	beforeEach(async () => {
		await setupRunningSurvey();
	});

	it("rejects a cross-origin submit", async () => {
		const { surveyId, questionId, token } = await setupRunningSurvey();
		const request = new Request(`${ORIGIN}/api/surveys/submit`, {
			method: "POST",
			headers: { origin: "https://evil.example.com", "content-type": "application/json" },
			body: JSON.stringify({ surveyId, token, answers: [{ questionId, value: "hi" }] }),
		});
		const response = await POST(request);
		expect(response.status).toBe(403);
	});

	it("accepts a same-origin submit with a valid token, then rejects reuse", async () => {
		const { surveyId, questionId, token } = await setupRunningSurvey();
		const makeRequest = () =>
			new Request(`${ORIGIN}/api/surveys/submit`, {
				method: "POST",
				headers: { origin: ORIGIN, "content-type": "application/json" },
				body: JSON.stringify({ surveyId, token, answers: [{ questionId, value: "hi" }] }),
			});
		await expect(POST(makeRequest()).then((response) => response.status)).resolves.toBe(200);
		await expect(POST(makeRequest()).then((response) => response.status)).resolves.toBe(400);
	});
});
