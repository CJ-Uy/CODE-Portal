import { describe, expect, it } from "vitest";
import { METRIC_KEYS } from "@/db/types";
import { formatEstimate, metricLabel, parseQuestionsField } from "./editor-input";

const SCALE = { type: "scale", prompt: "Overall, how satisfied were you?", required: true, metricKey: "overall", options: ["Very dissatisfied", "Very satisfied"] };
const TEXT = { type: "text", prompt: "What should the next session cover?" };

describe("parseQuestionsField", () => {
	it("accepts a scale with two labels and fills the required default", () => {
		const parsed = parseQuestionsField(JSON.stringify([SCALE, TEXT]));
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toMatchObject({ type: "scale", metricKey: "overall", options: ["Very dissatisfied", "Very satisfied"] });
		expect(parsed[1]?.required).toBe(false);
	});

	it("accepts the 30 question ceiling", () => {
		expect(parseQuestionsField(JSON.stringify(Array.from({ length: 30 }, () => TEXT)))).toHaveLength(30);
	});

	it.each([
		["missing field", null],
		["a file instead of text", new File(["x"], "x.json")],
		["malformed JSON", "[{"],
		["not an array", JSON.stringify(SCALE)],
		["no questions", "[]"],
		["a scale with 5 options", JSON.stringify([{ ...SCALE, options: ["1", "2", "3", "4", "5"] }])],
		["a tracked text question", JSON.stringify([{ ...TEXT, metricKey: "overall" }])],
		["a blank prompt", JSON.stringify([{ ...TEXT, prompt: "   " }])],
		["31 questions", JSON.stringify(Array.from({ length: 31 }, () => TEXT))],
	])("rejects %s with one friendly message", (_name, raw) => {
		expect(() => parseQuestionsField(raw)).toThrow("Check the questions and try again.");
	});
});

describe("metricLabel", () => {
	it.each([
		["overall", "Overall"],
		["flow", "Event flow"],
		["content", "Content"],
		["venue", "Venue"],
		["return_intent", "Return intent"],
		["learning", "Learning"],
	] as const)("%s -> %s", (key, label) => {
		expect(metricLabel(key)).toBe(label);
	});

	it("labels every metric key", () => {
		for (const key of METRIC_KEYS) expect(metricLabel(key)).not.toBe(key);
	});
});

describe("formatEstimate", () => {
	it.each([
		[0, "About 1 min"],
		[14, "About 1 min"],
		[60, "About 1 min"],
		[80, "About 2 min"],
		[180, "About 3 min"],
		[181, "About 4 min"],
	])("%i seconds -> %s", (seconds, label) => {
		expect(formatEstimate(seconds)).toBe(label);
	});
});
