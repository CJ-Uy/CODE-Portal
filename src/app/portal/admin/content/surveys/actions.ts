"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { createSurveyInputSchema, sendSurveyInputSchema } from "@/db/types";
import { defaultClosesAt } from "@/lib/feedback/stats";
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
			options: type === "scale" ? ["Strongly disagree", "Strongly agree"] : undefined,
		})),
	});
	const repositories = await getRepositories();
	const survey = await repositories.surveys.create(actor, input);
	revalidatePath("/portal/admin/content/surveys");
	redirect(`/portal/admin/content/surveys/${survey.id}`);
}

// Thin shim for the old draw-a-sample page until the real send panel replaces it: the form's
// sampleSize becomes an exact head count, and everything else takes its usual default.
export async function sendSurveyAction(formData: FormData) {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const surveyId = String(formData.get("surveyId") ?? "");
	const repositories = await getRepositories();
	const detail = await repositories.surveys.getById(actor, surveyId);
	if (!detail) throw new Error("Survey not found.");

	const now = new Date();
	const event = detail.survey.eventId
		? await repositories.events.getById(actor, detail.survey.eventId).catch(() => null)
		: null;
	// An event that ended long ago has a default close already in the past, so fall back to a fresh 72h window.
	const eventClosesAt = event ? defaultClosesAt(event.startsAt, event.endsAt) : null;
	const closesAt = eventClosesAt && eventClosesAt > now ? eventClosesAt : new Date(now.getTime() + 72 * 3_600_000);

	const input = sendSurveyInputSchema.parse({
		surveyId,
		invite: { mode: "count", count: Number(formData.get("sampleSize")) },
		allowWalkIn: true,
		shareWithOrganizers: true,
		emailInvitees: false,
		remind: true,
		closesAt,
		seed: nullableText(formData.get("seed")) ?? undefined,
	});
	await repositories.surveys.send(actor, input);
	revalidatePath(`/portal/admin/content/surveys/${input.surveyId}`);
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}
