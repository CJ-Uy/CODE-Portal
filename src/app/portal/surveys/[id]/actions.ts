"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { submitSurveyResponseInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function submitResponseAction(formData: FormData) {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const surveyId = String(formData.get("surveyId") ?? "");
	const answers: Array<{ questionId: string; value: string }> = [];
	for (const [key, value] of formData.entries()) {
		if (key.startsWith("q:") && typeof value === "string" && value.trim()) {
			answers.push({ questionId: key.slice(2), value: value.trim() });
		}
	}
	const input = submitSurveyResponseInputSchema.parse({ surveyId, answers });
	const repositories = await getRepositories();
	await repositories.surveys.submitResponse(actor, input);
	redirect(`/portal/surveys/${surveyId}?done=1`);
}
