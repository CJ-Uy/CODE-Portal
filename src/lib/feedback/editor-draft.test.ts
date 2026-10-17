import { describe, expect, it } from "vitest";
import type { SurveyQuestionInput } from "@/db/types";
import { newDraft, toDraft, toInput, trackedKey, withType } from "./editor-draft";

const OVERALL: SurveyQuestionInput = {
	type: "scale",
	prompt: "Overall, how satisfied were you with this event?",
	required: true,
	metricKey: "overall",
	options: ["Very dissatisfied", "Very satisfied"],
};

describe("scale -> text -> scale", () => {
	it("keeps the tracked tag, the labels and the prompt", () => {
		const asText = withType(toDraft(OVERALL, 0), "text");
		// Held back while it is a text question: not shown and not saved.
		expect(trackedKey(asText)).toBeUndefined();
		expect(toInput(asText)).toEqual({ type: "text", prompt: OVERALL.prompt, required: true });

		const back = withType(asText, "scale");
		expect(trackedKey(back)).toBe("overall");
		expect(toInput(back)).toEqual(OVERALL);
	});

	it("keeps the tag through a choice question too", () => {
		const asChoice = withType(toDraft(OVERALL, 0), "choice");
		expect(toInput(asChoice)).not.toHaveProperty("metricKey");
		expect(toInput(withType(asChoice, "scale"))).toMatchObject({ metricKey: "overall", options: ["Very dissatisfied", "Very satisfied"] });
	});
});

describe("withType", () => {
	it("gives a text question that becomes a scale the default labels", () => {
		const draft = withType(toDraft({ type: "text", prompt: "Anything else?", required: false }, 1), "scale");
		expect(toInput(draft).options).toEqual(["Strongly disagree", "Strongly agree"]);
	});

	it("keeps typed choices when switching away and back", () => {
		const choice = toDraft({ type: "choice", prompt: "Pace?", required: false, options: ["Too slow", "About right", "Too fast"] }, 2);
		expect(toInput(withType(withType(choice, "text"), "choice")).options).toEqual(["Too slow", "About right", "Too fast"]);
	});
});

describe("toInput", () => {
	it("omits blank help and trims choice lines", () => {
		const draft = { ...newDraft(3), type: "choice" as const, prompt: "  Pick one  ", help: "   ", choices: " A \n\n B " };
		expect(toInput(draft)).toEqual({ type: "choice", prompt: "Pick one", required: false, options: ["A", "B"] });
	});
});
