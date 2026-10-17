import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { insertNotification } from "@/db/repositories/notifications";
import type { SurveyDb } from "@/db/repositories/surveys";
import { crsEvents, surveyAssignments, surveyQuestions, surveys } from "@/db/schema";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { errorLabel } from "@/lib/feedback/safe-log";
import { estimateSeconds } from "@/lib/feedback/stats";
import type { EmailJob } from "@/server/email/jobs";
import { queueFeedbackEmail } from "./email";

export type ReminderDeps = {
	now: Date;
	notificationsEnabled: boolean;
	/** Null when FEATURE_EMAIL is off. */
	email: { queue: Queue<EmailJob>; baseUrl: string } | null;
};

/**
 * The one-time reminder for feedback forms, run by the per-minute cron. It usually goes 24h before close, but an admin
 * can send it early, so the wording never says "last day". System caller: no actor or permission check. Walk-ins are
 * never reminded.
 *
 * Each due form is claimed with a conditional UPDATE ... RETURNING before anything is sent, so a repeat tick (or a
 * concurrent one) finds nothing to claim and the reminder goes out at most once. A notification or email step that fails
 * after the claim is logged and not retried; the other step and the remaining claimed forms still run. A failed read of
 * the event title or the questions falls back to the form's own title and leaves the time estimate out.
 */
export async function runFeedbackReminders(db: SurveyDb, deps: ReminderDeps): Promise<{ surveys: number; notified: number; emailed: number }> {
	const { now } = deps;
	const claimed = await db
		.update(surveys)
		.set({ reminderSentAt: now })
		.where(and(eq(surveys.status, "running"), isNull(surveys.reminderSentAt), lte(surveys.reminderAt, now), gt(surveys.closesAt, now)))
		.returning();

	let notified = 0;
	let emailed = 0;
	for (const survey of claimed) {
		let title = survey.title;
		let estimate: string | null = null;
		try {
			const [event] = survey.eventId ? await db.select({ title: crsEvents.title }).from(crsEvents).where(eq(crsEvents.id, survey.eventId)).limit(1) : [];
			title = event?.title ?? survey.title;
			estimate = formatEstimate(estimateSeconds(await db.select({ type: surveyQuestions.type }).from(surveyQuestions).where(eq(surveyQuestions.surveyId, survey.id))));
		} catch (error) {
			console.error(`Feedback reminder details read failed for survey ${survey.id}; using the form's own title.`, errorLabel(error));
		}

		if (deps.notificationsEnabled) {
			try {
				const pending = await db
					.select({ memberId: surveyAssignments.memberId })
					.from(surveyAssignments)
					.where(and(eq(surveyAssignments.surveyId, survey.id), eq(surveyAssignments.source, "invited"), isNull(surveyAssignments.completedAt)));
				// ponytail: one insert per member, as survey send does; batch if an event nears the subrequest cap.
				for (const { memberId } of pending) {
					await insertNotification(db, {
						memberId,
						kind: "survey_reminder",
						title: `Reminder: feedback on ${title}`,
						body: estimate ? `It takes ${estimate.toLowerCase()}.` : "Your name isn't attached to your answers.",
						href: `/portal/surveys/${survey.id}`,
					});
					notified++;
				}
			} catch (error) {
				console.error(`Feedback reminder notifications failed for survey ${survey.id}`, error);
			}
		}

		if (deps.email && survey.emailInvitees && survey.closesAt) {
			try {
				const result = await queueFeedbackEmail(db, deps.email.queue, {
					surveyId: survey.id,
					createdBy: survey.createdBy,
					title,
					closesAt: survey.closesAt,
					estimate,
					kind: "reminder",
					baseUrl: deps.email.baseUrl,
					now,
				});
				if (result === "queued") emailed++;
			} catch (error) {
				console.error(`Feedback reminder email failed for survey ${survey.id}`, error);
			}
		}
	}
	return { surveys: claimed.length, notified, emailed };
}
