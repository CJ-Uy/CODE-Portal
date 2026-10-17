import { describe, expect, it } from "vitest";
import {
	FEEDBACK_EMPTY_ERROR,
	FEEDBACK_GENERIC_ERROR,
	parseFeedbackForm,
	parseOptions,
	safeFeedbackError,
	scaleLabels,
} from "./form";

describe("safeFeedbackError", () => {
	it.each([
		"This form has closed.",
		"Organizers give feedback through the debrief.",
		"You've already answered this form.",
		"This form is not open to you.",
		"Answer every required question.",
		"Answer each question once.",
		"Pick a value from 1 to 5.",
		"Pick one of the listed choices.",
		FEEDBACK_EMPTY_ERROR,
	])("passes the known message %j through", (message) => {
		expect(safeFeedbackError(message)).toBe(message);
	});

	it.each([undefined, null, 42, ["This form has closed."], "Answer references an unknown question.", "<b>hi</b>", ""])(
		"turns %j into the generic message",
		(value) => {
			expect(safeFeedbackError(value)).toBe(FEEDBACK_GENERIC_ERROR);
		},
	);
});

describe("parseFeedbackForm", () => {
	it("collects surveyId and trimmed q: answers, skipping blanks and other fields", () => {
		const form = new FormData();
		form.set("surveyId", "srv_1");
		form.set("q:a", " 4 ");
		form.set("q:b", "   ");
		form.set("q:c", "Great talk");
		form.set("note", "ignored");
		expect(parseFeedbackForm(form)).toEqual({
			surveyId: "srv_1",
			answers: [
				{ questionId: "a", value: "4" },
				{ questionId: "c", value: "Great talk" },
			],
		});
	});

	it("normalises CRLF so a 2000-character comment with line breaks stays within the limit", () => {
		const form = new FormData();
		form.set("surveyId", "srv_1");
		form.set("q:t", "line one\r\nline two\r\n");
		expect(parseFeedbackForm(form).answers).toEqual([{ questionId: "t", value: "line one\nline two" }]);
	});

	it("keeps repeated q: keys so the repository can reject them", () => {
		const form = new FormData();
		form.set("surveyId", "srv_1");
		form.append("q:a", "1");
		form.append("q:a", "2");
		expect(parseFeedbackForm(form).answers).toHaveLength(2);
	});

	it("returns an empty surveyId and no answers for an empty form", () => {
		expect(parseFeedbackForm(new FormData())).toEqual({ surveyId: "", answers: [] });
	});
});

describe("question options", () => {
	it("reads scale end labels", () => {
		expect(scaleLabels('["Not at all","Very much"]')).toEqual(["Not at all", "Very much"]);
	});

	it("falls back to empty labels for missing or malformed data", () => {
		expect(scaleLabels(null)).toEqual(["", ""]);
		expect(scaleLabels("not json")).toEqual(["", ""]);
		expect(scaleLabels('["Only low"]')).toEqual(["Only low", ""]);
	});

	it("keeps only string choices", () => {
		expect(parseOptions('["Yes","No",3,null]')).toEqual(["Yes", "No"]);
		expect(parseOptions('{"a":1}')).toEqual([]);
	});
});
