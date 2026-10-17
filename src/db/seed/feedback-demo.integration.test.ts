import { env } from "cloudflare:test";
import type { InferInsertModel } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditRepository } from "@/db/repositories/audit";
import { createSurveyResultsRepository } from "@/db/repositories/survey-results";
import * as schema from "@/db/schema";
import type { ResultsQuestion } from "@/db/types";
import type { Actor } from "@/server/auth/permissions";
import {
	seedFeedbackDemoAnswers,
	seedFeedbackDemoAssignments,
	seedFeedbackDemoDebriefs,
	seedFeedbackDemoEvents,
	seedFeedbackDemoMembers,
	seedFeedbackDemoQuestions,
	seedFeedbackDemoResponses,
	seedFeedbackDemoSurveys,
	seedMembers,
} from "./data";

const db = drizzle(env.DB, { schema });
const results = createSurveyResultsRepository(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_demo_admin", roles: ["super"] };
const NOW = new Date("2026-10-17T00:00:00.000Z");

type Text = Extract<ResultsQuestion, { kind: "text" }>;
const textQuestions = (questions: ResultsQuestion[]) => questions.filter((question): question is Text => question.kind === "text");

const TABLES = [
	"survey_answers",
	"survey_responses",
	"survey_assignments",
	"survey_questions",
	"surveys",
	"event_debriefs",
	"crs_events",
	"audit_logs",
	"members",
];

async function clear() {
	for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
}

// D1 binds at most 100 parameters per statement, so the rows go in small chunks.
async function load<T extends SQLiteTable>(table: T, rows: InferInsertModel<T>[]) {
	for (let index = 0; index < rows.length; index += 5) await db.insert(table).values(rows.slice(index, index + 5)).run();
}

// The local demo seed, read back through the real results repository: the numbers the results page will print.
describe("feedback demo seed on D1", () => {
	beforeAll(async () => {
		await clear();
		await load(schema.members, [...seedMembers, ...seedFeedbackDemoMembers]);
		await load(schema.crsEvents, seedFeedbackDemoEvents);
		await load(schema.eventDebriefs, seedFeedbackDemoDebriefs);
		await load(schema.surveys, seedFeedbackDemoSurveys);
		await load(schema.surveyQuestions, seedFeedbackDemoQuestions);
		await load(schema.surveyAssignments, seedFeedbackDemoAssignments);
		await load(schema.surveyResponses, seedFeedbackDemoResponses);
		await load(schema.surveyAnswers, seedFeedbackDemoAnswers);
	});

	afterAll(clear);

	it("shows 8 responses with the header numbers the page prints", async () => {
		const all = await results.getResults(admin, "srv_demo_past", { filter: "all" }, NOW);
		expect(all).toMatchObject({
			status: "running",
			responseCount: 8,
			invitedCount: 24,
			invitedResponded: 6,
			walkInCount: 2,
			belowThreshold: false,
			shareWithOrganizers: true,
			eventType: "official",
		});
		expect(all.questions).toHaveLength(7);

		const overall = all.questions[0];
		expect(overall.kind === "scale" && overall.summary).toMatchObject({ n: 8, topTwoPct: 75, mean: 4 });
		// One past event is not enough history for a comparison line.
		expect(overall.kind === "scale" && overall.baseline).toBeNull();
	});

	it("narrows to the invited sample", async () => {
		const invited = await results.getResults(admin, "srv_demo_past", { filter: "invited" }, NOW);
		expect(invited.responseCount).toBe(6);
		expect(invited.walkInCount).toBe(2);
	});

	it("gives admins the hidden comment, marked, and gives organizers neither it nor a summary", async () => {
		const all = await results.getResults(admin, "srv_demo_past", { filter: "all" }, NOW);
		const [valuable, change] = textQuestions(all.questions);
		expect(valuable.answers).toHaveLength(8);
		expect(change.answers).toHaveLength(7);
		expect(change.answers.filter((answer) => answer.hidden)).toHaveLength(1);
		// The word cloud has something to click: "case" is in three of the valuable-part comments.
		expect(valuable.terms[0]).toEqual({ term: "case", count: 3 });

		const organizer = await results.getOrganizerResults(admin, "evt_demo_past", NOW);
		expect(organizer?.state).toBe("ready");
		const [, organizerChange] = textQuestions(organizer?.results?.questions ?? []);
		expect(organizerChange.answers).toHaveLength(6);
		expect(organizer?.results?.summary).toBeNull();
	});
});
