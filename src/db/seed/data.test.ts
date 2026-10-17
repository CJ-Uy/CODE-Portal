import { describe, expect, it } from "vitest";
import { startOfUtc8Day } from "@/lib/date-slots";
import { canFilterInvited } from "@/lib/feedback/results-view";
import { scaleSummary } from "@/lib/feedback/stats";
import { RESERVED_SLUG_DEFAULTS } from "@/lib/links";
import {
	seedFeedbackDemoAnswers,
	seedFeedbackDemoAssignments,
	seedFeedbackDemoAttendance,
	seedFeedbackDemoDebriefs,
	seedFeedbackDemoEvents,
	seedFeedbackDemoMembers,
	seedFeedbackDemoQuestions,
	seedFeedbackDemoResponses,
	seedFeedbackDemoSurveys,
	seedLinkDailyStats,
	seedPointTypes,
	seedReservedSlugs,
	seedShortLinks,
} from "./data";

describe("link seed data", () => {
	it("seeds all route-shadow reserved slugs from the links helper", () => {
		expect(seedReservedSlugs.map((item) => item.slug)).toEqual(RESERVED_SLUG_DEFAULTS);
	});

	it("seeds a preview-ready link with multi-day analytics", () => {
		expect(seedShortLinks[0]).toMatchObject({
			id: "lnk_demo",
			previewTitle: "Welcome to CODE",
			previewDescription: "Ateneo CODE member resources and sign-in.",
			clickCount: 9,
		});
		expect(seedLinkDailyStats).toHaveLength(3);
		expect(new Set(seedLinkDailyStats.map((row) => row.date))).toEqual(new Set(["2026-06-17", "2026-06-18"]));
	});
});

describe("point-type seeds", () => {
	it("provides the three baseline point types", () => {
		expect(seedPointTypes).toEqual([
			expect.objectContaining({ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 0 }),
			expect.objectContaining({ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 1 }),
			expect.objectContaining({ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 2 }),
		]);
	});
});

describe("feedback demo seed", () => {
	const questionIds = new Set(seedFeedbackDemoQuestions.map((question) => question.id));

	it("is one past event with a sent standard form and a debrief", () => {
		expect(seedFeedbackDemoEvents).toHaveLength(1);
		expect(seedFeedbackDemoSurveys).toEqual([
			expect.objectContaining({ eventId: seedFeedbackDemoEvents[0].id, status: "running", templateId: "stpl_standard", sampleSize: 24 }),
		]);
		expect(seedFeedbackDemoQuestions).toHaveLength(7);
		expect(seedFeedbackDemoDebriefs).toEqual([expect.objectContaining({ eventId: seedFeedbackDemoEvents[0].id })]);
		expect(seedFeedbackDemoEvents[0].endsAt!.getTime()).toBeLessThan(seedFeedbackDemoSurveys[0].sentAt!.getTime());
	});

	it("has 8 responses, 5 invited and 3 walk-ins, matching the assignments", () => {
		expect(seedFeedbackDemoResponses).toHaveLength(8);
		expect(seedFeedbackDemoResponses.filter((response) => response.source === "invited")).toHaveLength(5);
		expect(seedFeedbackDemoResponses.filter((response) => response.source === "walk_in")).toHaveLength(3);

		const invited = seedFeedbackDemoAssignments.filter((assignment) => assignment.source === "invited");
		expect(invited).toHaveLength(24);
		expect(invited.filter((assignment) => assignment.completedAt)).toHaveLength(5);
		expect(seedFeedbackDemoAssignments.filter((assignment) => assignment.source === "walk_in" && assignment.completedAt)).toHaveLength(3);
		// Enough walk-ins that the invited-only filter does not single them out.
		expect(canFilterInvited(3)).toBe(true);
		// Every assignment is for a member the demo creates.
		const memberIds = new Set(seedFeedbackDemoMembers.map((member) => member.id));
		expect(seedFeedbackDemoAssignments.every((assignment) => memberIds.has(assignment.memberId))).toBe(true);
	});

	it("checks in everyone who was invited or walked in, once each, during the event", () => {
		const event = seedFeedbackDemoEvents[0];
		expect(seedFeedbackDemoAttendance).toHaveLength(27);
		expect(new Set(seedFeedbackDemoAttendance.map((row) => row.memberId))).toEqual(new Set(seedFeedbackDemoAssignments.map((row) => row.memberId)));
		expect(seedFeedbackDemoAttendance.every((row) => row.eventId === event.id && row.scannedBy === "mem_demo_admin")).toBe(true);
		expect(
			seedFeedbackDemoAttendance.every(
				(row) => row.scannedAt.getTime() >= event.startsAt.getTime() && row.scannedAt.getTime() <= event.endsAt!.getTime(),
			),
		).toBe(true);
	});

	it("keeps responses anonymous: no member link, day-truncated, ids with no answer order", () => {
		// The response table has no member column at all; this is the guard if one is ever added.
		expect(seedFeedbackDemoResponses.every((response) => !("memberId" in response))).toBe(true);
		expect(seedFeedbackDemoResponses.every((response) => startOfUtc8Day(response.submittedAt as Date).getTime() === (response.submittedAt as Date).getTime())).toBe(true);

		const responseIds = seedFeedbackDemoResponses.map((response) => response.id);
		const answerIds = seedFeedbackDemoAnswers.map((answer) => answer.id);
		expect(new Set(responseIds).size).toBe(responseIds.length);
		expect(new Set(answerIds).size).toBe(answerIds.length);

		// Reading the first question's answers in id order, as the results page does, must not give back submission order.
		const first = seedFeedbackDemoAnswers.filter((answer) => answer.questionId === "srvq_demo_past_1");
		const byId = [...first].sort((a, b) => (a.id < b.id ? -1 : 1)).map((answer) => answer.responseId);
		expect(byId).not.toEqual(first.map((answer) => answer.responseId));
	});

	it("answers only the survey's questions, with ratings from 1 to 5", () => {
		const responseIds = new Set(seedFeedbackDemoResponses.map((response) => response.id));
		expect(seedFeedbackDemoAnswers.every((answer) => responseIds.has(answer.responseId) && questionIds.has(answer.questionId))).toBe(true);
		const ratings = seedFeedbackDemoAnswers.filter((answer) => Number(answer.questionId.at(-1)) <= 5).map((answer) => answer.value);
		expect(ratings).toHaveLength(8 * 5);
		expect(ratings.every((value) => /^[1-5]$/.test(value))).toBe(true);
	});

	it("has a spread of ratings and exactly one hidden comment", () => {
		const overall = scaleSummary(seedFeedbackDemoAnswers.filter((answer) => answer.questionId === "srvq_demo_past_1").map((answer) => Number(answer.value)));
		expect(overall).toMatchObject({ n: 8, counts: [0, 1, 1, 3, 3], mean: 4, topTwoPct: 75 });

		const hidden = seedFeedbackDemoAnswers.filter((answer) => answer.hiddenFromOrganizers);
		expect(hidden).toHaveLength(1);
		// Only a comment can be hidden.
		expect(["srvq_demo_past_6", "srvq_demo_past_7"]).toContain(hidden[0].questionId);
	});

	it("includes Taglish comments", () => {
		const comments = seedFeedbackDemoAnswers.filter((answer) => !/^[1-5]$/.test(answer.value)).map((answer) => answer.value);
		expect(comments.filter((value) => /\b(yung|sana|pero|di ko)\b/i.test(value)).length).toBeGreaterThanOrEqual(3);
	});
});
