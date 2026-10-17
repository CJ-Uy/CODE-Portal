"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { submitSurveyResponseInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import { FEEDBACK_EMPTY_ERROR, FEEDBACK_GENERIC_ERROR, parseFeedbackForm, safeFeedbackError } from "@/lib/feedback/form";
import { errorLabel } from "@/lib/feedback/safe-log";

export async function submitResponseAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const { surveyId, answers } = parseFeedbackForm(formData);
	const page = `/portal/surveys/${encodeURIComponent(surveyId)}`;
	const failed = (message: string) => `${page}?error=${encodeURIComponent(message)}`;

	// redirect() works by throwing, so it stays out of the try block.
	let target = `${page}?done=1`;
	const input = submitSurveyResponseInputSchema.safeParse({ surveyId, answers });
	if (!input.success) {
		target = failed(answers.length === 0 ? FEEDBACK_EMPTY_ERROR : FEEDBACK_GENERIC_ERROR);
	} else {
		try {
			await (await getRepositories()).surveys.submitResponse(actor, input.data);
		} catch (error) {
			const message = safeFeedbackError(error instanceof Error ? error.message : null);
			// The error type only: a failed query's message can quote the answers it was writing.
			if (message === FEEDBACK_GENERIC_ERROR) console.error("Feedback submit failed", { surveyId, error: errorLabel(error) });
			target = failed(message);
		}
	}
	redirect(target);
}
