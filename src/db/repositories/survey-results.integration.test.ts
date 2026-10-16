import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { MetricKey, ResultsQuestion, SurveySource } from "@/db/types";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createSurveyResultsRepository } from "./survey-results";

const db = drizzle(env.DB, { schema });
const results = createSurveyResultsRepository(db, createAuditRepository(db));

const admin: Actor = { memberId: "mem_admin", roles: ["super"] };
const crs: Actor = { memberId: "mem_crs", roles: ["retention"] };
const owner: Actor = { memberId: "mem_owner", roles: ["member"] };
const staffAdmin: Actor = { memberId: "mem_staff", roles: ["member"] };
const scanner: Actor = { memberId: "mem_scan", roles: ["member"] };
const attendee: Actor = { memberId: "mem_att", roles: ["member"] };

const NOW = new Date("2026-10-16T00:00:00.000Z");
const DAY = 86_400_000;
const past = new Date(NOW.getTime() - DAY);
const future = new Date(NOW.getTime() + DAY);

type Scale = Extract<ResultsQuestion, { kind: "scale" }>;
type Choice = Extract<ResultsQuestion, { kind: "choice" }>;
type Text = Extract<ResultsQuestion, { kind: "text" }>;

async function seedEvent(id: string, type = "workshop") {
	await db.insert(schema.crsEvents).values({
		id,
		title: `Event ${id}`,
		type,
		status: "approved",
		place: "Room",
		startsAt: past,
		description: "Test event",
		createdBy: "mem_owner",
		checkinSecret: "secret",
	});
}

type QuestionSeed = { id: string; type: "scale" | "choice" | "text"; metricKey?: MetricKey; options?: string[] };

async function seedSurvey(input: {
	id: string;
	eventId?: string | null;
	status?: "draft" | "running" | "closed";
	closesAt?: Date | null;
	share?: boolean;
	questions: QuestionSeed[];
}) {
	await db.insert(schema.surveys).values({
		id: input.id,
		eventId: input.eventId ?? null,
		title: `Survey ${input.id}`,
		status: input.status ?? "closed",
		closesAt: input.closesAt === undefined ? past : input.closesAt,
		shareWithOrganizers: input.share ?? true,
		createdBy: "mem_admin",
	});
	await db.insert(schema.surveyQuestions).values(
		input.questions.map((question, index) => ({
			id: question.id,
			surveyId: input.id,
			position: index + 1,
			type: question.type,
			prompt: `Prompt ${question.id}`,
			optionsJson: question.type === "text" ? null : JSON.stringify(question.options ?? ["Low", "High"]),
			metricKey: question.metricKey ?? null,
		})),
	);
}

let seq = 0;
/** One anonymous response; returns the answer ids keyed by question id. */
async function respond(surveyId: string, source: SurveySource, answers: Record<string, string>) {
	const responseId = `srvr_${++seq}`;
	await db.insert(schema.surveyResponses).values({ id: responseId, surveyId, source, submittedAt: past });
	const ids: Record<string, string> = {};
	for (const [questionId, value] of Object.entries(answers)) {
		ids[questionId] = `srva_${++seq}`;
		await db.insert(schema.surveyAnswers).values({ id: ids[questionId], responseId, questionId, value });
	}
	return ids;
}

/** Several one-question responses at once. */
async function respondMany(surveyId: string, questionId: string, source: SurveySource, values: string[]) {
	for (const value of values) await respond(surveyId, source, { [questionId]: value });
}

async function assign(surveyId: string, source: SurveySource, total: number, completed: number) {
	for (let i = 0; i < total; i += 1) {
		const memberId = `mem_${surveyId}_${source}_${i}`;
		await db.insert(schema.members).values({ id: memberId, email: `${memberId}@example.com`, status: "active" });
		await db.insert(schema.surveyAssignments).values({ surveyId, memberId, source, completedAt: i < completed ? past : null });
	}
}

describe("survey results on D1", () => {
	beforeEach(async () => {
		for (const table of [
			"survey_answers",
			"survey_responses",
			"survey_assignments",
			"survey_questions",
			"surveys",
			"event_debriefs",
			"event_staff",
			"crs_events",
			"audit_logs",
			"members",
		]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_admin", "mem_crs", "mem_owner", "mem_staff", "mem_scan", "mem_att"]) {
			await db.insert(schema.members).values({ id, email: `${id}@example.com`, status: "active" });
		}
		await seedEvent("evt_1");
		await db.insert(schema.eventStaff).values([
			{ eventId: "evt_1", memberId: "mem_staff", role: "admin" },
			{ eventId: "evt_1", memberId: "mem_scan", role: "scanner" },
		]);
	});

	it("hides results below 3 responses", async () => {
		await seedSurvey({ id: "srv_1", eventId: "evt_1", questions: [{ id: "q1", type: "scale", metricKey: "overall" }] });
		await respondMany("srv_1", "q1", "invited", ["5", "4"]);

		const view = await results.getResults(admin, "srv_1", { filter: "all" }, NOW);

		expect(view).toMatchObject({ responseCount: 2, belowThreshold: true, questions: [], summary: null });
	});

	it("rejects a member without survey:configure", async () => {
		await seedSurvey({ id: "srv_1", questions: [{ id: "q1", type: "text" }] });
		await expect(results.getResults(owner, "srv_1", { filter: "all" }, NOW)).rejects.toThrow("Not authorized");
		await expect(results.feedbackForEvents(owner, ["evt_1"])).rejects.toThrow("Not authorized");
		await expect(results.setAnswerHidden(owner, { answerId: "x", hidden: true })).rejects.toThrow("Not authorized");
	});

	it("summarizes scale answers and filters to the invited sample", async () => {
		await seedSurvey({
			id: "srv_1",
			eventId: "evt_1",
			status: "running",
			closesAt: future,
			questions: [
				{ id: "q1", type: "scale", metricKey: "overall", options: ["Poor", "Great"] },
				{ id: "q2", type: "choice", options: ["Yes", "No", "Maybe"] },
				{ id: "q3", type: "text" },
			],
		});
		await assign("srv_1", "invited", 4, 3);
		await assign("srv_1", "walk_in", 1, 1);
		await respond("srv_1", "invited", { q1: "5", q2: "Yes", q3: "Pizza was great" });
		await respond("srv_1", "invited", { q1: "4", q2: "Yes", q3: "More pizza please" });
		await respond("srv_1", "invited", { q1: "4", q2: "No" });
		await respond("srv_1", "walk_in", { q1: "1", q3: "Too loud" });

		const all = await results.getResults(crs, "srv_1", { filter: "all" }, NOW);
		expect(all).toMatchObject({
			eventId: "evt_1",
			eventType: "workshop",
			status: "running",
			invitedCount: 4,
			invitedResponded: 3,
			walkInCount: 1,
			responseCount: 4,
			belowThreshold: false,
		});
		const scale = all.questions[0] as Scale;
		expect(scale).toMatchObject({ kind: "scale", metricKey: "overall", labels: ["Poor", "Great"], baseline: null });
		expect(scale.summary).toEqual({ n: 4, counts: [1, 0, 0, 2, 1], mean: 3.5, topTwoPct: 75 });
		expect(all.questions[1] as Choice).toMatchObject({ kind: "choice", options: ["Yes", "No", "Maybe"], counts: { Yes: 2, No: 1, Maybe: 0 }, n: 3 });
		const text = all.questions[2] as Text;
		expect(text.answers.map((answer) => answer.value).sort()).toEqual(["More pizza please", "Pizza was great", "Too loud"]);
		expect(text.terms[0]).toEqual({ term: "pizza", count: 2 });

		const invited = await results.getResults(crs, "srv_1", { filter: "invited" }, NOW);
		expect(invited.responseCount).toBe(3);
		expect(invited.walkInCount).toBe(1);
		expect((invited.questions[0] as Scale).summary).toMatchObject({ n: 3, mean: 4.3, topTwoPct: 100 });
		expect((invited.questions[2] as Text).answers).toHaveLength(2);
	});

	it("applies the threshold after the invited filter", async () => {
		await seedSurvey({ id: "srv_1", questions: [{ id: "q1", type: "scale" }] });
		await respondMany("srv_1", "q1", "invited", ["5", "4"]);
		await respondMany("srv_1", "q1", "walk_in", ["3", "3"]);

		expect((await results.getResults(admin, "srv_1", { filter: "all" }, NOW)).belowThreshold).toBe(false);
		expect(await results.getResults(admin, "srv_1", { filter: "invited" }, NOW)).toMatchObject({ responseCount: 2, belowThreshold: true, questions: [] });
	});

	it("compares to past same-type events only with enough data", async () => {
		// The current form: 5 answers on a tracked question, plus an untracked scale.
		await seedSurvey({
			id: "srv_now",
			eventId: "evt_1",
			status: "running",
			closesAt: future,
			questions: [
				{ id: "now_overall", type: "scale", metricKey: "overall" },
				{ id: "now_plain", type: "scale" },
			],
		});
		for (const value of ["5", "5", "4", "4", "3"]) await respond("srv_now", "invited", { now_overall: value, now_plain: value });

		// Three closed past workshops with overall means 4, 4 and 5; the last is running but past its close.
		const pastSurveys: Array<[string, string, Partial<Parameters<typeof seedSurvey>[0]>, string[]]> = [
			["evt_a", "srv_a", {}, ["4", "4", "4"]],
			["evt_b", "srv_b", {}, ["3", "4", "5"]],
			["evt_c", "srv_c", { status: "running", closesAt: past }, ["5", "5", "5"]],
			// Excluded: another type, still open, too few answers.
			["evt_d", "srv_d", {}, ["1", "1", "1"]],
			["evt_e", "srv_e", { status: "running", closesAt: future }, ["1", "1", "1"]],
			["evt_f", "srv_f", {}, ["1", "1"]],
		];
		for (const [eventId, surveyId, extra, values] of pastSurveys) {
			await seedEvent(eventId, eventId === "evt_d" ? "seminar" : "workshop");
			await seedSurvey({ id: surveyId, eventId, questions: [{ id: `${surveyId}_q`, type: "scale", metricKey: "overall" }], ...extra });
			await respondMany(surveyId, `${surveyId}_q`, "invited", values);
		}

		const view = await results.getResults(admin, "srv_now", { filter: "all" }, NOW);
		expect((view.questions[0] as Scale).baseline).toEqual({ mean: 4.3, events: 3 });
		expect((view.questions[1] as Scale).baseline).toBeNull();

		await env.DB.prepare("DELETE FROM surveys WHERE id = 'srv_c'").run();
		const fewer = await results.getResults(admin, "srv_now", { filter: "all" }, NOW);
		expect((fewer.questions[0] as Scale).baseline).toBeNull();
	});

	it("needs 5 answers on this form before comparing", async () => {
		await seedSurvey({ id: "srv_now", eventId: "evt_1", questions: [{ id: "now_q", type: "scale", metricKey: "overall" }] });
		await respondMany("srv_now", "now_q", "invited", ["5", "5", "4", "4"]);
		for (const id of ["a", "b", "c"]) {
			await seedEvent(`evt_${id}`);
			await seedSurvey({ id: `srv_${id}`, eventId: `evt_${id}`, questions: [{ id: `q_${id}`, type: "scale", metricKey: "overall" }] });
			await respondMany(`srv_${id}`, `q_${id}`, "invited", ["4", "4", "4"]);
		}

		const view = await results.getResults(admin, "srv_now", { filter: "all" }, NOW);
		expect((view.questions[0] as Scale).baseline).toBeNull();
	});

	it("gives organizers results without hidden comments or the summary", async () => {
		await seedSurvey({
			id: "srv_1",
			eventId: "evt_1",
			questions: [
				{ id: "q1", type: "scale", metricKey: "overall" },
				{ id: "q2", type: "text" },
				{ id: "q3", type: "text" },
			],
		});
		await db
			.update(schema.surveys)
			.set({
				aiSummaryJson: JSON.stringify({ themes: [], usedComments: 3, totalComments: 3 }),
				aiSummaryAt: past,
				aiSummaryResponseCount: 3,
			})
			.where(eq(schema.surveys.id, "srv_1"));
		await respond("srv_1", "invited", { q1: "5", q2: "Loved the pizza" });
		await respond("srv_1", "invited", { q1: "4", q2: "Great speakers" });
		const hiddenIds = await respond("srv_1", "invited", { q1: "2", q2: "Terrible acoustics everywhere", q3: "Rude staff member" });

		await results.setAnswerHidden(admin, { answerId: hiddenIds.q2, hidden: true });
		await results.setAnswerHidden(admin, { answerId: hiddenIds.q3, hidden: true });
		await expect(results.setAnswerHidden(admin, { answerId: hiddenIds.q1, hidden: true })).rejects.toThrow("Only comments can be hidden.");

		const adminView = await results.getResults(admin, "srv_1", { filter: "all" }, NOW);
		const adminText = adminView.questions[1] as Text;
		expect(adminText.answers.find((answer) => answer.id === hiddenIds.q2)).toMatchObject({ hidden: true });
		expect(adminText.terms.map((t) => t.term)).toContain("acoustics");
		expect(adminView.summary).toMatchObject({ usedComments: 3, generatedAt: past, responseCountAtGeneration: 3 });

		for (const actor of [owner, staffAdmin, crs]) {
			const organizer = await results.getOrganizerResults(actor, "evt_1", NOW);
			expect(organizer).toMatchObject({ state: "ready", surveyId: "srv_1" });
			const text = organizer!.results!.questions[1] as Text;
			expect(text.answers.map((answer) => answer.value).sort()).toEqual(["Great speakers", "Loved the pizza"]);
			expect(text.answers.every((answer) => !answer.hidden)).toBe(true);
			expect(text.terms.map((t) => t.term)).not.toContain("acoustics");
			// A comment question left empty by hiding still shows, with no answers.
			expect(organizer!.results!.questions[2]).toMatchObject({ kind: "text", answers: [], terms: [] });
			expect((organizer!.results!.questions[0] as Scale).summary.n).toBe(3);
			expect(organizer!.results!.summary).toBeNull();
		}

		await results.setAnswerHidden(admin, { answerId: hiddenIds.q2, hidden: false });
		const unhidden = await results.getOrganizerResults(owner, "evt_1", NOW);
		expect((unhidden!.results!.questions[1] as Text).answers).toHaveLength(3);

		const audits = await db.select().from(schema.auditLogs);
		expect(audits.map((entry) => entry.action).sort()).toEqual(["survey:answer_hide", "survey:answer_hide", "survey:answer_unhide"]);
		expect(audits[0]).toMatchObject({ targetType: "survey", targetId: "srv_1", category: "survey" });
	});

	it("tells organizers when results are not shared or too few", async () => {
		expect(await results.getOrganizerResults(owner, "evt_1", NOW)).toEqual({ state: "none" });

		await seedSurvey({ id: "srv_1", eventId: "evt_1", status: "draft", closesAt: null, questions: [{ id: "q1", type: "scale" }] });
		expect(await results.getOrganizerResults(owner, "evt_1", NOW)).toEqual({ state: "none" });

		await db.update(schema.surveys).set({ status: "closed", shareWithOrganizers: false }).where(eq(schema.surveys.id, "srv_1"));
		await respondMany("srv_1", "q1", "invited", ["5", "4", "4"]);
		expect(await results.getOrganizerResults(owner, "evt_1", NOW)).toEqual({ state: "not_shared", surveyId: "srv_1" });

		await db.update(schema.surveys).set({ shareWithOrganizers: true }).where(eq(schema.surveys.id, "srv_1"));
		await env.DB.prepare("DELETE FROM survey_responses WHERE id = (SELECT MIN(id) FROM survey_responses)").run();
		expect(await results.getOrganizerResults(owner, "evt_1", NOW)).toEqual({ state: "too_few", surveyId: "srv_1" });
	});

	it("denies a plain attendee", async () => {
		await seedSurvey({ id: "srv_1", eventId: "evt_1", questions: [{ id: "q1", type: "scale" }] });
		await respondMany("srv_1", "q1", "invited", ["5", "4", "4"]);

		expect(await results.getOrganizerResults(attendee, "evt_1", NOW)).toBeNull();
		expect(await results.getOrganizerResults(scanner, "evt_1", NOW)).toBeNull();
	});

	it("builds archive rows per event", async () => {
		await seedSurvey({
			id: "srv_1",
			eventId: "evt_1",
			questions: [
				{ id: "q1", type: "scale", metricKey: "overall" },
				{ id: "q2", type: "scale", metricKey: "venue" },
			],
		});
		await assign("srv_1", "invited", 6, 3);
		await assign("srv_1", "walk_in", 1, 1);
		for (const value of ["5", "4", "4"]) await respond("srv_1", "invited", { q1: value, q2: "1" });
		await respond("srv_1", "walk_in", { q1: "2", q2: "1" });

		// A walk-in-only form under the threshold, with a debrief.
		await seedEvent("evt_2");
		await seedSurvey({ id: "srv_2", eventId: "evt_2", questions: [{ id: "q3", type: "scale", metricKey: "overall" }] });
		await respondMany("srv_2", "q3", "walk_in", ["5"]);
		await db.insert(schema.eventDebriefs).values({ eventId: "evt_2", intended: "A workshop" });

		// No overall question at all.
		await seedEvent("evt_3");
		await seedSurvey({ id: "srv_3", eventId: "evt_3", questions: [{ id: "q4", type: "text" }] });
		await seedEvent("evt_none");

		// Far more ids than D1 binds in one statement.
		const padding = Array.from({ length: 150 }, (_, i) => `evt_missing_${i}`);
		const rows = await results.feedbackForEvents(crs, [...padding, "evt_1", "evt_2", "evt_3", "evt_none"]);

		expect(rows.get("evt_1")).toEqual({
			surveyId: "srv_1",
			overall: { n: 4, counts: [0, 1, 0, 2, 1], mean: 3.8, topTwoPct: 75 },
			responses: 4,
			invitedRate: 0.5,
			hasDebrief: false,
		});
		expect(rows.get("evt_2")).toEqual({ surveyId: "srv_2", overall: null, responses: 1, invitedRate: null, hasDebrief: true });
		expect(rows.get("evt_3")).toMatchObject({ surveyId: "srv_3", overall: null, responses: 0 });
		expect(rows.has("evt_none")).toBe(false);
		expect(rows.size).toBe(3);
	});
});
