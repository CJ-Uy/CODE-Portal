"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { createFromTemplateInputSchema, saveTemplateInputSchema, updateDraftInputSchema } from "@/db/types";
import { formatEstimate, parseQuestionsField, QUESTIONS_ERROR } from "@/lib/feedback/editor-input";
import { parseRunningForm, RUNNING_SAVED } from "@/lib/feedback/running-input";
import { errorLabel } from "@/lib/feedback/safe-log";
import { parseSendForm } from "@/lib/feedback/send-input";
import { estimateSeconds } from "@/lib/feedback/stats";
import { requireActor } from "@/server/auth/actor";
import { emailConfigFromEnv, emailDbFromEnv, emailQueueFromEnv } from "@/server/email/db";
import { assertFeatureEnabled, isFeatureEnabled } from "@/server/features";
import { getSummarizer } from "@/server/feedback/ai";
import { queueFeedbackEmail } from "@/server/feedback/email";

const SURVEYS_PATH = "/portal/admin/content/surveys";

export type ActionError = { error: string };

// Shows a repository message only when it is one we wrote for admins; anything else is logged and replaced, so a raw
// database or runtime error never reaches the page.
function safeMessage(error: unknown, known: readonly string[], fallback: string): string {
	if (error instanceof Error && known.includes(error.message)) return error.message;
	console.error(fallback, error);
	return fallback;
}

const CREATE_ERRORS = ["This event already has a feedback form.", "Event not found.", "Template not found."] as const;

// Returns only on failure: success redirects to the new draft. Errors come back as text so the form keeps its choices.
export async function createFromTemplateAction(formData: FormData): Promise<ActionError | undefined> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const parsed = createFromTemplateInputSchema.safeParse({
		templateId: formData.get("templateId"),
		eventId: nullableText(formData.get("eventId")),
	});
	if (!parsed.success) return { error: "Pick a template." };

	const repositories = await getRepositories();
	let surveyId: string;
	try {
		surveyId = (await repositories.surveys.createFromTemplate(actor, parsed.data)).id;
	} catch (error) {
		return { error: safeMessage(error, CREATE_ERRORS, "Couldn't create the form. Try again.") };
	}
	revalidatePath(SURVEYS_PATH);
	redirect(`${SURVEYS_PATH}/${surveyId}`);
}

export type SaveDraftResult = ActionError | { saved: true };

// Takes the title and the editor's questions; the draft's status is checked again by the repository.
export async function saveDraftAction(formData: FormData): Promise<SaveDraftResult> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	let questions;
	try {
		questions = parseQuestionsField(formData.get("questions"));
	} catch {
		return { error: QUESTIONS_ERROR };
	}
	const parsed = updateDraftInputSchema.safeParse({ surveyId: formData.get("surveyId"), title: formData.get("title"), questions });
	if (!parsed.success) return { error: "Give the form a title of up to 200 characters." };

	const repositories = await getRepositories();
	try {
		await repositories.surveys.updateDraft(actor, parsed.data);
	} catch (error) {
		return { error: safeMessage(error, ["Questions can't change after sending.", "Survey not found."], "Couldn't save the draft. Try again.") };
	}
	revalidatePath(`${SURVEYS_PATH}/${parsed.data.surveyId}`);
	return { saved: true };
}

const SEND_ERRORS = [
	"Pick a closing time in the future.",
	"No one is eligible for this form yet.",
	"This form has already been sent.",
	"Survey not found.",
] as const;

// Returns only on failure: success redirects to the survey page. Sending notifies members, so a failure to email
// them afterwards never undoes it; the redirect carries a notice instead.
export async function sendSurveyAction(formData: FormData): Promise<ActionError | undefined> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	let input;
	try {
		input = parseSendForm(formData);
	} catch {
		return { error: "Check the number of people to invite and the closing time, then try again." };
	}

	const repositories = await getRepositories();
	try {
		await repositories.surveys.send(actor, input);
	} catch (error) {
		return { error: safeMessage(error, SEND_ERRORS, "Couldn't send the form. Check the survey page before trying again.") };
	}

	// send() has already checked survey:configure, which is what authorizes the narrow feedback email path below.
	let notice: "no_sender" | "email_failed" | null = null;
	if (input.emailInvitees && isFeatureEnabled("email")) {
		try {
			const detail = await repositories.surveys.getById(actor, input.surveyId);
			const event = detail?.survey.eventId ? await repositories.events.getById(actor, detail.survey.eventId) : null;
			const result = await queueFeedbackEmail(emailDbFromEnv(), emailQueueFromEnv(), {
				surveyId: input.surveyId,
				createdBy: actor.memberId,
				title: event?.title ?? detail?.survey.title ?? "this form",
				closesAt: input.closesAt,
				estimate: detail ? formatEstimate(estimateSeconds(detail.questions)) : null,
				kind: "invite",
				baseUrl: emailConfigFromEnv().publicBaseUrl,
			});
			if (result === "no_sender") notice = "no_sender";
		} catch (error) {
			console.error("Feedback invite email failed after the form was sent.", error);
			notice = "email_failed";
		}
	}
	revalidatePath(SURVEYS_PATH);
	revalidatePath(`${SURVEYS_PATH}/${input.surveyId}`);
	redirect(`${SURVEYS_PATH}/${input.surveyId}${notice ? `?notice=${notice}` : ""}`);
}

// Every survey detail page, whichever form it shows, so the action never trusts a path from the client.
const DETAIL_PAGES = `${SURVEYS_PATH}/[id]`;

const RUNNING_ERRORS = [
	"Pick a closing time in the future.",
	"The reminder was already sent.",
	"This form has already closed.",
	"Only a running form can be edited.",
	"Survey not found.",
] as const;

export type RunningResult = { ok: string } | { error: string } | null;

// Used with useActionState, so it takes the previous result first. Errors come back as text; the panel keeps its place.
export async function updateRunningAction(_previous: RunningResult, formData: FormData): Promise<RunningResult> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	let parsed;
	try {
		parsed = parseRunningForm(formData);
	} catch {
		return { error: "Check the closing time and try again." };
	}

	const repositories = await getRepositories();
	try {
		await repositories.surveys.updateRunning(actor, parsed.input);
	} catch (error) {
		return { error: safeMessage(error, RUNNING_ERRORS, "Couldn't update the form. Check the survey page before trying again.") };
	}
	revalidatePath(DETAIL_PAGES, "page");
	return { ok: RUNNING_SAVED[parsed.intent] };
}

const HIDE_ERRORS = ["Answer not found.", "Only comments can be hidden."] as const;

// Hiding only keeps a comment from organizers; admins still see it, marked.
export async function setAnswerHiddenAction(formData: FormData): Promise<ActionError | undefined> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	const answerId = nullableText(formData.get("answerId"));
	if (!answerId) return { error: "Couldn't find that comment." };

	const repositories = await getRepositories();
	try {
		await repositories.surveyResults.setAnswerHidden(actor, { answerId, hidden: formData.get("hidden") === "1" });
	} catch (error) {
		return { error: safeMessage(error, HIDE_ERRORS, "Couldn't change that comment. Try again.") };
	}
	revalidatePath(DETAIL_PAGES, "page");
}

// "none": the model ran (or the comments did not support a summary) and nothing reliable came back; an earlier draft stays.
export type SummaryActionState = { status: "drafted" } | { status: "none" } | { status: "error"; message: string } | null;

// Never logs the thrown error itself: a database or model error can quote the comments being summarized.
export async function generateSummaryAction(_previous: SummaryActionState, formData: FormData): Promise<SummaryActionState> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	const surveyId = nullableText(formData.get("surveyId"));
	const summarizer = getSummarizer();
	if (!surveyId || !summarizer) return { status: "error", message: "Summaries aren't available here." };

	const repositories = await getRepositories();
	let summary;
	try {
		summary = await repositories.surveyResults.generateSummary(actor, surveyId, summarizer);
	} catch (error) {
		console.error("Feedback summary failed.", { surveyId, error: errorLabel(error) });
		return { status: "error", message: "Couldn't draft a summary right now. Try again in a minute." };
	}
	if (!summary) return { status: "none" };
	revalidatePath(DETAIL_PAGES, "page");
	return { status: "drafted" };
}

const TEMPLATES_PATH = `${SURVEYS_PATH}/templates`;

export type SaveTemplateResult = { error: string };

// Returns only on failure: success redirects to the list, so a caller sees no result. Errors come back as
// text instead of throwing so the editor keeps what the admin typed.
export async function saveTemplateAction(formData: FormData): Promise<SaveTemplateResult | undefined> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	let questions;
	try {
		questions = parseQuestionsField(formData.get("questions"));
	} catch {
		return { error: QUESTIONS_ERROR };
	}
	const parsed = saveTemplateInputSchema.safeParse({
		id: nullableText(formData.get("id")) ?? undefined,
		name: formData.get("name"),
		description: formData.get("description") ?? "",
		questions,
	});
	if (!parsed.success) return { error: "Give the template a name (up to 120 characters) and keep the description under 300." };

	const repositories = await getRepositories();
	try {
		await repositories.surveys.saveTemplate(actor, parsed.data);
	} catch (error) {
		const gone = error instanceof Error && error.message === "Template not found.";
		return { error: gone ? "This template was archived or no longer exists." : "Couldn't save the template. Try again." };
	}
	revalidatePath(TEMPLATES_PATH);
	redirect(TEMPLATES_PATH);
}

// Returns only on failure: success redirects to the template list.
export async function archiveTemplateAction(_previous: ActionError | null, formData: FormData): Promise<ActionError | null> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();
	const repositories = await getRepositories();
	try {
		await repositories.surveys.archiveTemplate(actor, String(formData.get("id") ?? ""));
	} catch (error) {
		// A stale second archive, from another tab or a double click, finds nothing left to archive.
		if (error instanceof Error && error.message === "Template not found.") return { error: "This template was already archived or no longer exists." };
		console.error("Could not archive the template.", errorLabel(error));
		return { error: "Couldn't archive the template. Try again." };
	}
	revalidatePath(TEMPLATES_PATH);
	redirect(TEMPLATES_PATH);
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}
