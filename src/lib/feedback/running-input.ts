import { type UpdateRunningInput, updateRunningInputSchema } from "@/db/types";
import { parseLocalClosesAt } from "@/lib/feedback/send-input";

export type RunningIntent = "closesAt" | "close" | "remind" | "share";

/** What the page says after each change went through. */
export const RUNNING_SAVED: Record<RunningIntent, string> = {
	closesAt: "Closing time updated.",
	close: "Form closed.",
	remind: "Reminder queued. It goes out the next time the reminder job runs.",
	share: "Sharing updated.",
};

/**
 * The manage panel posts one small form per control, each naming its `intent`. Exactly one change is built from it, so a
 * stray field can never close a form that was only asked to move its closing time. Throws when the form does not fit.
 */
export function parseRunningForm(formData: FormData): { intent: RunningIntent; input: UpdateRunningInput } {
	const surveyId = formData.get("surveyId");
	const intent = formData.get("intent");
	switch (intent) {
		case "closesAt":
			return { intent, input: updateRunningInputSchema.parse({ surveyId, closesAt: parseLocalClosesAt(String(formData.get("closesAt") ?? "")) }) };
		case "close":
			return { intent, input: updateRunningInputSchema.parse({ surveyId, close: true }) };
		case "remind":
			return { intent, input: updateRunningInputSchema.parse({ surveyId, remindNow: true }) };
		case "share":
			return { intent, input: updateRunningInputSchema.parse({ surveyId, shareWithOrganizers: formData.get("shareWithOrganizers") === "1" }) };
		default:
			throw new Error("Unknown change.");
	}
}
