import { createAuditRepository } from "@/db/repositories/audit";
import type { EmailDb } from "@/db/repositories/email-audience";
import { createEmailCampaignsRepository, feedbackEmailRoute } from "@/db/repositories/email-campaigns";
import { feedbackEmailContent, type FeedbackEmailKind } from "@/lib/feedback/email";
import { queueEmailCampaign, type EmailJob } from "@/server/email/jobs";

const SEND_DELAY_MS = 2 * 60_000;

/** True when the feedback category exists, is not archived, and has a usable default sender. */
export async function feedbackEmailReady(db: EmailDb): Promise<boolean> {
	return (await feedbackEmailRoute(db)) !== null;
}

/**
 * Schedules a feedback invite or reminder to a survey's invitees two minutes out and queues the job.
 * Callers decide whether FEATURE_EMAIL is on and authorize the request.
 */
export async function queueFeedbackEmail(
	db: EmailDb,
	queue: Queue<EmailJob>,
	input: { surveyId: string; createdBy: string; title: string; closesAt: Date; kind: FeedbackEmailKind; baseUrl: string; now?: Date },
): Promise<"queued" | "no_sender"> {
	const now = input.now ?? new Date();
	const content = feedbackEmailContent(input.kind, {
		title: input.title,
		link: `${input.baseUrl}/portal/surveys/${input.surveyId}`,
		closesAt: input.closesAt,
	});
	const at = new Date(now.getTime() + SEND_DELAY_MS);
	const campaign = await createEmailCampaignsRepository(db, createAuditRepository(db)).createFeedbackCampaign({
		surveyId: input.surveyId,
		createdBy: input.createdBy,
		...content,
		at,
	});
	if (!campaign) return "no_sender";
	await queueEmailCampaign(queue, campaign.id, at, now.getTime());
	return "queued";
}
