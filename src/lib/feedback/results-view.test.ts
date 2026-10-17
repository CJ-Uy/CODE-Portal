import { describe, expect, it } from "vitest";
import type { ResultsQuestion } from "@/db/types";
import {
	baselineLine,
	canDraftSummary,
	canFilterInvited,
	chipSteps,
	CHIP_STEPS,
	closingLine,
	countComments,
	filterAnswers,
	invitedLine,
	isLowResponseRate,
	percentOf,
	segmentLabel,
	summaryView,
} from "./results-view";

const textQuestion = (values: string[]): ResultsQuestion => ({
	kind: "text",
	questionId: "q",
	prompt: "Anything else?",
	answers: values.map((value, index) => ({ id: `a${index}`, value, hidden: false })),
	terms: [],
});

describe("response rate", () => {
	it("prints responded of invited with a rounded percentage", () => {
		expect(invitedLine(6, 24)).toBe("6 of 24 invited (25%)");
		expect(invitedLine(31, 47)).toBe("31 of 47 invited (66%)");
	});

	it("has no invited line when nobody was invited", () => {
		expect(invitedLine(0, 0)).toBeNull();
	});

	it("flags only a rate under 30%", () => {
		expect(isLowResponseRate(6, 24)).toBe(true);
		expect(isLowResponseRate(5, 20)).toBe(true);
		expect(isLowResponseRate(6, 20)).toBe(false);
		expect(isLowResponseRate(3, 10)).toBe(false);
		expect(isLowResponseRate(0, 0)).toBe(false);
	});

	it("does not round a 29.6% rate up to a pass", () => {
		expect(invitedLine(37, 125)).toBe("37 of 125 invited (30%)");
		expect(isLowResponseRate(37, 125)).toBe(true);
	});
});

describe("canFilterInvited", () => {
	it("offers the invited-only view with no walk-ins or enough of them to hide among", () => {
		expect(canFilterInvited(0)).toBe(true);
		expect(canFilterInvited(3)).toBe(true);
		expect(canFilterInvited(12)).toBe(true);
	});

	it("withholds it when 1 or 2 walk-ins could be isolated by comparing the two views", () => {
		expect(canFilterInvited(1)).toBe(false);
		expect(canFilterInvited(2)).toBe(false);
	});
});

describe("closingLine", () => {
	const now = new Date("2026-10-17T00:00:00.000Z");

	it("says when a running form closes", () => {
		expect(closingLine({ status: "running", closesAt: new Date("2026-10-20T08:00:00.000Z") }, now)).toBe("Open until Oct 20, 2026, 4:00 PM");
		expect(closingLine({ status: "running", closesAt: null }, now)).toBe("Open");
	});

	it("says when a closed form closed, and flags one closed by hand", () => {
		expect(closingLine({ status: "closed", closesAt: new Date("2026-10-10T08:00:00.000Z") }, now)).toBe("Closed Oct 10, 2026, 4:00 PM");
		expect(closingLine({ status: "closed", closesAt: new Date("2026-10-20T08:00:00.000Z") }, now)).toBe("Closed early");
		expect(closingLine({ status: "closed", closesAt: null }, now)).toBe("Closed");
	});

	it("has nothing to say for a draft", () => {
		expect(closingLine({ status: "draft", closesAt: null }, now)).toBeNull();
	});
});

describe("bar labels", () => {
	it("reads each segment as a value and a response count", () => {
		expect(segmentLabel(5, 12)).toBe("5: 12 responses");
		expect(segmentLabel(2, 1)).toBe("2: 1 response");
		expect(segmentLabel(1, 0)).toBe("1: 0 responses");
	});

	it("rounds a share and survives an empty total", () => {
		expect(percentOf(3, 8)).toBe(38);
		expect(percentOf(0, 0)).toBe(0);
	});
});

describe("baselineLine", () => {
	it("names the event type, the average to one decimal and the past event count", () => {
		expect(baselineLine("official", { mean: 4.2, events: 12 })).toBe("Official events average 4.2 (12 past events)");
		expect(baselineLine("alumni_night", { mean: 4, events: 3 })).toBe("Alumni night events average 4.0 (3 past events)");
	});

	it("is absent without a baseline or an event type", () => {
		expect(baselineLine("official", null)).toBeNull();
		expect(baselineLine(null, { mean: 4.2, events: 12 })).toBeNull();
	});
});

describe("chipSteps", () => {
	it("spreads counts across every size, smallest to largest", () => {
		const sized = chipSteps([
			{ term: "case", count: 9 },
			{ term: "room", count: 6 },
			{ term: "sound", count: 4 },
			{ term: "snacks", count: 1 },
		]);
		expect(sized.map((entry) => entry.step)).toEqual([CHIP_STEPS - 1, 2, 1, 0]);
	});

	it("keeps the order it was given and never leaves the range", () => {
		const sized = chipSteps([
			{ term: "b", count: 5 },
			{ term: "a", count: 5 },
		]);
		expect(sized.map((entry) => entry.term)).toEqual(["b", "a"]);
		expect(sized.every((entry) => entry.step >= 0 && entry.step < CHIP_STEPS)).toBe(true);
	});

	it("handles an empty cloud", () => {
		expect(chipSteps([])).toEqual([]);
	});
});

describe("filterAnswers", () => {
	const answers = [
		{ id: "1", value: "The case discussion was great" },
		{ id: "2", value: "Sana mas maraming cases next time" },
		{ id: "3", value: "Showcase booth was crowded" },
	];

	it("returns the same list, in order, with no filter", () => {
		expect(filterAnswers(answers, { term: null, query: "  " })).toBe(answers);
	});

	it("matches a clicked chip on whole tokens, not substrings", () => {
		expect(filterAnswers(answers, { term: "case", query: "" }).map((answer) => answer.id)).toEqual(["1"]);
	});

	it("matches the search box as a case-insensitive substring", () => {
		expect(filterAnswers(answers, { term: null, query: "CASE" }).map((answer) => answer.id)).toEqual(["1", "2", "3"]);
	});

	it("applies both together", () => {
		expect(filterAnswers(answers, { term: "case", query: "great" }).map((answer) => answer.id)).toEqual(["1"]);
		expect(filterAnswers(answers, { term: "case", query: "booth" })).toEqual([]);
	});
});

describe("summary eligibility", () => {
	it("needs 3 responses and at least one real comment", () => {
		expect(canDraftSummary({ responseCount: 3, questions: [textQuestion(["Great"])] })).toBe(true);
		expect(canDraftSummary({ responseCount: 2, questions: [textQuestion(["Great"])] })).toBe(false);
		expect(canDraftSummary({ responseCount: 8, questions: [textQuestion([])] })).toBe(false);
		expect(canDraftSummary({ responseCount: 8, questions: [textQuestion(["   "])] })).toBe(false);
	});

	it("counts comments across text questions only", () => {
		const scale: ResultsQuestion = {
			kind: "scale",
			questionId: "s",
			prompt: "Overall",
			help: null,
			metricKey: "overall",
			labels: ["Low", "High"],
			summary: { n: 3, counts: [0, 0, 1, 1, 1], mean: 4, topTwoPct: 67 },
			baseline: null,
		};
		expect(countComments([scale, textQuestion(["a", "b"]), textQuestion(["c"])])).toBe(3);
	});
});

describe("summaryView", () => {
	const generatedAt = new Date("2026-10-17T06:00:00.000Z");
	const stored = {
		themes: [
			{ label: "Sound", description: "The audio was hard to hear.", share: "several", quotes: ["Fix the sound system."] },
			{ label: "Cases", description: "People liked the practice cases.", share: "most", quotes: ["Hands-on case practice."] },
		],
		usedComments: 15,
		totalComments: 15,
		generatedAt,
		responseCountAtGeneration: 8,
	};

	it("prints the footnote with the comment count and the day it was drafted", () => {
		const view = summaryView(stored, 8, 15);
		expect(view?.themes).toHaveLength(2);
		expect(view?.footnote).toBe("Machine-drafted from 15 comments on Oct 17, 2026. Read the comments before acting on it.");
		expect(view?.stale).toBe(false);
		expect(view?.staleNote).toBeNull();
	});

	it("says it was an even sample when fewer comments were used than exist", () => {
		const view = summaryView({ ...stored, usedComments: 40, totalComments: 55 }, 8, 55);
		expect(view?.footnote).toBe(
			"Machine-drafted from 40 comments on Oct 17, 2026. Based on an even sample of 40 of 55 comments. Read the comments before acting on it.",
		);
	});

	it("offers a regenerate and the comment gap once more responses have come in", () => {
		const view = summaryView({ ...stored, totalComments: 18, usedComments: 18, responseCountAtGeneration: 18 }, 26, 26);
		expect(view?.stale).toBe(true);
		expect(view?.staleNote).toBe("Drafted from 18 of 26 comments");
	});

	it("is stale without a note when the comment count did not grow", () => {
		const view = summaryView({ ...stored, responseCountAtGeneration: 6 }, 8, 15);
		expect(view?.stale).toBe(true);
		expect(view?.staleNote).toBeNull();
	});

	it("skips malformed themes instead of crashing", () => {
		const view = summaryView(
			{
				themes: [null, "x", { label: "" }, { label: "Venue", share: "huge", quotes: [3, "Too small.", " "] }, { description: "no label" }],
				usedComments: "many",
			},
			4,
			4,
		);
		expect(view?.themes).toEqual([{ label: "Venue", description: "", share: "several", quotes: ["Too small."] }]);
		expect(view?.footnote).toBe("Machine-drafted from 0 comments. Read the comments before acting on it.");
	});

	it("has no view when nothing usable was stored", () => {
		expect(summaryView(null, 8, 15)).toBeNull();
		expect(summaryView({}, 8, 15)).toBeNull();
		expect(summaryView({ themes: "oops" }, 8, 15)).toBeNull();
		expect(summaryView({ themes: [] }, 8, 15)).toBeNull();
	});
});
