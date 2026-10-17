import { z } from "zod";
import { surveyQuestionInputSchema, type MetricKey, type SurveyQuestionInput } from "@/db/types";

const questionsSchema = z.array(surveyQuestionInputSchema).min(1).max(30);

export const QUESTIONS_ERROR = "Check the questions and try again.";

/** The editor posts its questions as one hidden JSON field. The client is never trusted: this is where it gets validated. */
export function parseQuestionsField(raw: FormDataEntryValue | null): SurveyQuestionInput[] {
	try {
		if (typeof raw !== "string") throw new Error("missing");
		return questionsSchema.parse(JSON.parse(raw));
	} catch {
		throw new Error(QUESTIONS_ERROR);
	}
}

// Typed as a Record so adding a metric key without a label is a compile error.
const METRIC_LABELS: Record<MetricKey, string> = {
	overall: "Overall",
	flow: "Event flow",
	content: "Content",
	venue: "Venue",
	return_intent: "Return intent",
	learning: "Learning",
};

export function metricLabel(key: MetricKey): string {
	return METRIC_LABELS[key];
}

/** "About 2 min". Rounds to the nearest minute (never below 1), so the 125s seeded Standard form reads "About 2 min". */
export function formatEstimate(seconds: number): string {
	return `About ${Math.max(1, Math.round(seconds / 60))} min`;
}
