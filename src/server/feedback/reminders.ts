import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { insertNotification } from "@/db/repositories/notifications";
import type { SurveyDb } from "@/db/repositories/surveys";
import { crsEvents, surveyAssignments, surveys } from "@/db/schema";
import type { EmailJob } from "@/server/email/jobs";
import { queueFeedbackEmail } from "./email";

export type ReminderDeps = {
	now: Date;
	notificationsEnabled: boolean;
	/** Null when FEATURE_EMAIL is off. */
	email: { queue: Queue<EmailJob>; baseUrl: string } | null;
};

/**
 * The one-time "last day" reminder for feedback forms, run by the per-minute cron. System caller: no actor or
 * permission check. Walk-ins are never reminded.
 *
 * Each due form is claimed with a conditional UPDATE ... RETURNING before anything is sent, so a repeat tick (or a
 * concurrent one) finds nothing to claim and the reminder goes out at most once. A notification or email step that fails
 * after the claim is logged and not retried; the other step and the remaining claimed forms still run.
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
		const [event] = survey.eventId ? await db.select({ title: crsEvents.title }).from(crsEvents).where(eq(crsEvents.id, survey.eventId)).limit(1) : [];
		const title = event?.title ?? survey.title;

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
						title: `Last day for feedback on ${title}`,
						body: "It takes about two minutes.",
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
