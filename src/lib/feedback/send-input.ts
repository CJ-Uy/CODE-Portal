import { sendSurveyInputSchema, type SendSurveyInput } from "@/db/types";
import { fromLocalInput, toLocalInput } from "@/lib/date-slots";
import { defaultClosesAt } from "@/lib/feedback/stats";

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const WINDOW_MS = 72 * 3_600_000;

// A checkbox that is not ticked is simply absent from the form.
const checked = (formData: FormData, name: string) => formData.get(name) !== null;

/** The send panel posts its choices as a plain form; this turns them into the repository's input and throws when they do not fit. */
export function parseSendForm(formData: FormData): SendSurveyInput {
	const mode = formData.get("invite") ?? "suggested";
	const invite = mode === "count" ? { mode, count: Number(formData.get("count")) } : { mode };

	// toLocalInput round-trips only a real calendar time, so "2026-02-31T10:00" is refused instead of rolling into March.
	const raw = String(formData.get("closesAt") ?? "");
	const closesAt = fromLocalInput(raw);
	if (!LOCAL_INPUT.test(raw) || toLocalInput(closesAt) !== raw) throw new Error("Pick a closing time.");

	return sendSurveyInputSchema.parse({
		surveyId: formData.get("surveyId"),
		invite,
		allowWalkIn: checked(formData, "allowWalkIn"),
		shareWithOrganizers: checked(formData, "shareWithOrganizers"),
		emailInvitees: checked(formData, "emailInvitees"),
		remind: checked(formData, "remind"),
		closesAt,
	});
}

/** Event end plus 72 hours. An event that ended long ago, or a form with no event, gets a fresh 72 hour window from now. */
export function sendDefaultClosesAt(event: { startsAt: Date; endsAt: Date | null } | null, now: Date): Date {
	const fromNow = new Date(now.getTime() + WINDOW_MS);
	if (!event) return fromNow;
	const closesAt = defaultClosesAt(event.startsAt, event.endsAt);
	return closesAt > now ? closesAt : fromNow;
}
