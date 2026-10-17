import type { MetricKey, ResultsQuestion } from "@/db/types";
import { RESULTS_MIN_RESPONSES } from "@/lib/feedback/stats";

// Pure helpers behind the organizer feedback view and the admin event page. Client-safe: types only from the db layer.

type ScaleQuestion = Extract<ResultsQuestion, { kind: "scale" }>;

/** The organizer states that have no results to show. "ready" renders the results themselves. */
export type OrganizerWaitingState = "none" | "not_shared" | "too_few";

const ORGANIZER_NOTES: Record<OrganizerWaitingState, string> = {
	none: "No feedback form was sent for this event.",
	not_shared: "Feedback for this event is not shared with organizers.",
	too_few: `Results appear at ${RESULTS_MIN_RESPONSES} responses.`,
};

export function organizerNote(state: OrganizerWaitingState): string {
	return ORGANIZER_NOTES[state];
}

/** The scale questions that feed the cross-event metrics (overall, flow, ...), in form order. */
export function trackedScaleQuestions(questions: ResultsQuestion[]): Array<ScaleQuestion & { metricKey: MetricKey }> {
	return questions.filter((question): question is ScaleQuestion & { metricKey: MetricKey } => question.kind === "scale" && question.metricKey !== null);
}
