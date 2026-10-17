import { formatUtc8DateTime } from "@/lib/date-slots";
import type { EmailBlock } from "@/lib/email/types";

export const FEEDBACK_EMAIL_CATEGORY_ID = "ecat_feedback";

export type FeedbackEmailKind = "invite" | "reminder";

// The brief gives copy for the invite only; the reminder reuses the same preheader. How long the form takes comes from
// its own questions, never a fixed figure, since a custom form can run much longer than the standard one.
const PREHEADER = "Your feedback helps the next one go better.";

const text = (id: string, body: string): EmailBlock => ({ id, type: "text", props: { text: body } });

/**
 * `estimate` is formatEstimate's "About 2 min" for the form's questions, or null when they could not be read, in which
 * case the copy leaves the time out. The reminder can go out days before close ("Send reminder now"), so it never says
 * "last day".
 */
export function feedbackEmailContent(
	kind: FeedbackEmailKind,
	{ title, link, closesAt, estimate }: { title: string; link: string; closesAt: Date; estimate: string | null },
): { subject: string; preheader: string; blocks: EmailBlock[] } {
	const closes = formatUtc8DateTime(closesAt);
	const takes = estimate ? `takes ${estimate.toLowerCase()}` : null;
	const greeting = text("fb_hi", "Hi {{first_name}},");
	const button: EmailBlock = { id: "fb_btn", type: "button", props: { label: "Share feedback", href: link } };
	if (kind === "reminder") {
		return {
			subject: `Reminder: share feedback on ${title}`,
			preheader: PREHEADER,
			blocks: [
				greeting,
				text("fb_body", `If you've already answered, thank you, and you can ignore this. If not, ${takes ? `it ${takes}, and ` : ""}the form closes ${closes}.`),
				button,
			],
		};
	}
	return {
		subject: `How was ${title}?`,
		preheader: PREHEADER,
		blocks: [
			greeting,
			text("fb_body", `Thanks for coming to ${title}. We'd like your feedback${takes ? `. It ${takes}` : ""}.`),
			text("fb_names", "CRS can see your name with your answers so they can follow up. Organizers see the answers without names."),
			button,
			text("fb_open", `Open until ${closes}.`),
		],
	};
}
