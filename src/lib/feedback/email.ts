import { formatUtc8DateTime } from "@/lib/date-slots";
import type { EmailBlock } from "@/lib/email/types";

export const FEEDBACK_EMAIL_CATEGORY_ID = "ecat_feedback";

export type FeedbackEmailKind = "invite" | "reminder";

// The brief gives copy for the invite only; the reminder reuses the same preheader.
const PREHEADER = "Two minutes of feedback helps the next one go better.";

const text = (id: string, body: string): EmailBlock => ({ id, type: "text", props: { text: body } });

export function feedbackEmailContent(
	kind: FeedbackEmailKind,
	{ title, link, closesAt }: { title: string; link: string; closesAt: Date },
): { subject: string; preheader: string; blocks: EmailBlock[] } {
	const closes = formatUtc8DateTime(closesAt);
	const greeting = text("fb_hi", "Hi {{first_name}},");
	const button: EmailBlock = { id: "fb_btn", type: "button", props: { label: "Share feedback", href: link } };
	if (kind === "reminder") {
		return {
			subject: `Last day to share feedback on ${title}`,
			preheader: PREHEADER,
			blocks: [greeting, text("fb_body", `If you've already answered, thank you, and you can ignore this. If not, the form closes ${closes}.`), button],
		};
	}
	return {
		subject: `How was ${title}?`,
		preheader: PREHEADER,
		blocks: [
			greeting,
			text("fb_body", `Thanks for coming to ${title}. We'd like your feedback. It takes about two minutes, and your name isn't attached to your answers.`),
			button,
			text("fb_open", `Open until ${closes}.`),
		],
	};
}
