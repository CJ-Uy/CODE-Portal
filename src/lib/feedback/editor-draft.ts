import type { MetricKey, SurveyQuestionInput } from "@/db/types";

export const DEFAULT_LOW = "Strongly disagree";
export const DEFAULT_HIGH = "Strongly agree";

export type QuestionType = SurveyQuestionInput["type"];

// What the editor's inputs edit. Scale labels, choices and the metric tag live in their own fields, so
// switching type back and forth does not throw away what was typed or the tag; `toInput` folds only what
// the current type supports into the stored shape.
export type Draft = {
	key: number;
	type: QuestionType;
	prompt: string;
	help: string;
	required: boolean;
	metricKey?: MetricKey;
	low: string;
	high: string;
	choices: string;
};

export function toDraft(question: SurveyQuestionInput, key: number): Draft {
	const options = question.options ?? [];
	return {
		key,
		type: question.type,
		prompt: question.prompt,
		help: question.help ?? "",
		required: question.required === true,
		metricKey: question.metricKey,
		low: question.type === "scale" ? (options[0] ?? "") : "",
		high: question.type === "scale" ? (options[1] ?? "") : "",
		choices: question.type === "choice" ? options.join("\n") : "",
	};
}

export function toInput(draft: Draft): SurveyQuestionInput {
	const help = draft.help.trim();
	return {
		type: draft.type,
		prompt: draft.prompt.trim(),
		...(help ? { help } : {}),
		required: draft.required,
		// Only a scale can be tracked across events, so the tag is held back (not deleted) for other types.
		...(draft.type === "scale" && draft.metricKey ? { metricKey: draft.metricKey } : {}),
		...(draft.type === "scale" ? { options: [draft.low.trim(), draft.high.trim()] } : {}),
		...(draft.type === "choice"
			? {
					options: draft.choices
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean),
				}
			: {}),
	};
}

export function newDraft(key: number): Draft {
	return { key, type: "scale", prompt: "", help: "", required: false, low: DEFAULT_LOW, high: DEFAULT_HIGH, choices: "" };
}

/** Changes the answer type. Everything else, the metric tag included, is kept so toggling back is lossless. */
export function withType(draft: Draft, type: QuestionType): Draft {
	return { ...draft, type, ...(type === "scale" && !draft.low && !draft.high ? { low: DEFAULT_LOW, high: DEFAULT_HIGH } : {}) };
}

/** The tag shows (and is saved) only while the question is a scale. */
export function trackedKey(draft: Draft): MetricKey | undefined {
	return draft.type === "scale" ? draft.metricKey : undefined;
}
