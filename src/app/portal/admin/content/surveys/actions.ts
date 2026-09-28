"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { createSurveyInputSchema, sampleSurveyInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function createSurveyAction(formData: FormData) {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const prompts = String(formData.get("prompts") ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const type = String(formData.get("type") ?? "text") as "scale" | "text" | "choice";
	const input = createSurveyInputSchema.parse({
		title: formData.get("title"),
		eventId: nullableText(formData.get("eventId")),
		questions: prompts.map((prompt) => ({
			type,
			prompt,
			options: type === "scale" ? ["1", "2", "3", "4", "5"] : undefined,
		})),
	});
	const repositories = await getRepositories();
	const survey = await repositories.surveys.create(actor, input);
	revalidatePath("/portal/admin/content/surveys");
	redirect(`/portal/admin/content/surveys/${survey.id}`);
}

export async function sampleSurveyAction(formData: FormData) {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const input = sampleSurveyInputSchema.parse({
		surveyId: formData.get("surveyId"),
		sampleSize: Number(formData.get("sampleSize")),
		seed: nullableText(formData.get("seed")) ?? undefined,
	});
	const repositories = await getRepositories();
	await repositories.surveys.sample(actor, input);
	revalidatePath(`/portal/admin/content/surveys/${input.surveyId}`);
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}
