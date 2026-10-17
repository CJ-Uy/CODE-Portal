import { RESPONDENT_STATE_MESSAGES } from "@/db/repositories/surveys";

export const FEEDBACK_GENERIC_ERROR = "Something went wrong. Please try again.";
export const FEEDBACK_EMPTY_ERROR = "Answer at least one question.";

// The only strings the form page will print from `?error=`. Anything else (a stray repository error, a
// hand-edited URL) shows the generic line, so the query string can never put arbitrary text on the page.
const KNOWN_ERRORS = new Set<string>([
	...Object.values(RESPONDENT_STATE_MESSAGES),
	"Answer every required question.",
	"Answer each question once.",
	"Pick a value from 1 to 5.",
	"Pick one of the listed choices.",
	FEEDBACK_EMPTY_ERROR,
]);

export function safeFeedbackError(message: unknown): string {
	return typeof message === "string" && KNOWN_ERRORS.has(message) ? message : FEEDBACK_GENERIC_ERROR;
}

/** Reads `surveyId` and every non-blank `q:<questionId>` field. Browsers submit textarea newlines as CRLF, so normalise before trimming. */
export function parseFeedbackForm(formData: FormData): { surveyId: string; answers: Array<{ questionId: string; value: string }> } {
	const answers: Array<{ questionId: string; value: string }> = [];
	for (const [key, value] of formData.entries()) {
		if (!key.startsWith("q:") || typeof value !== "string") continue;
		const trimmed = value.replace(/\r\n/g, "\n").trim();
		if (trimmed) answers.push({ questionId: key.slice(2), value: trimmed });
	}
	return { surveyId: String(formData.get("surveyId") ?? ""), answers };
}

/** `optionsJson` holds a JSON string array for scale (end labels) and choice (choices); bad data reads as empty. */
export function parseOptions(optionsJson: string | null): string[] {
	try {
		const parsed: unknown = JSON.parse(optionsJson ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === "string") : [];
	} catch {
		return [];
	}
}

export function scaleLabels(optionsJson: string | null): [low: string, high: string] {
	const [low = "", high = ""] = parseOptions(optionsJson);
	return [low, high];
}
