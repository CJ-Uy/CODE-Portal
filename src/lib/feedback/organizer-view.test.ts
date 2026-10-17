import { describe, expect, it } from "vitest";
import type { ResultsQuestion } from "@/db/types";
import { organizerNote, trackedScaleQuestions } from "./organizer-view";

const scale = (questionId: string, metricKey: "overall" | "flow" | null): ResultsQuestion => ({
	kind: "scale",
	questionId,
	prompt: `Rate ${questionId}`,
	help: null,
	metricKey,
	labels: ["Low", "High"],
	summary: { n: 3, counts: [0, 0, 1, 1, 1], mean: 4, topTwoPct: 67 },
	baseline: null,
});

describe("organizerNote", () => {
	it("says why there are no results in each waiting state", () => {
		expect(organizerNote("none")).toBe("No feedback form was sent for this event.");
		expect(organizerNote("not_shared")).toBe("Feedback for this event is not shared with organizers.");
		expect(organizerNote("too_few")).toBe("Results appear at 3 responses.");
	});
});

describe("trackedScaleQuestions", () => {
	it("keeps only scale questions with a metric key, in form order", () => {
		const questions: ResultsQuestion[] = [
			scale("a", "flow"),
			scale("b", null),
			{ kind: "choice", questionId: "c", prompt: "Pick", options: ["x"], counts: { x: 1 }, n: 1 },
			{ kind: "text", questionId: "d", prompt: "Why", answers: [], terms: [] },
			scale("e", "overall"),
		];
		expect(trackedScaleQuestions(questions).map((question) => question.questionId)).toEqual(["a", "e"]);
	});

	it("is empty when nothing is tracked", () => {
		expect(trackedScaleQuestions([scale("a", null)])).toEqual([]);
		expect(trackedScaleQuestions([])).toEqual([]);
	});
});
