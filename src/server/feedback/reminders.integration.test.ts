import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { emailCampaigns, notifications, surveyQuestions, surveys } from "@/db/schema";
import type { EmailJob } from "@/server/email/jobs";
import { runFeedbackReminders } from "./reminders";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-18T12:00:00Z");
const HOUR = 3_600_000;
const noEmail = { now: NOW, notificationsEnabled: true, email: null };

async function seedSurvey(id: string, patch: { status?: string; closesAt?: number | null; reminderAt?: number | null; reminderSentAt?: number | null; emailInvitees?: number; eventId?: string | null } = {}) {
	const p = { status: "running", closesAt: NOW.getTime() + 24 * HOUR, reminderAt: NOW.getTime() - 60_000, reminderSentAt: null, emailInvitees: 0, eventId: null, ...patch };
	await env.DB.prepare("INSERT INTO surveys (id, event_id, title, status, created_by, closes_at, reminder_at, reminder_sent_at, email_invitees) VALUES (?, ?, ?, ?, 'mem_admin', ?, ?, ?, ?)")
		.bind(id, p.eventId, `Survey ${id}`, p.status, p.closesAt, p.reminderAt, p.reminderSentAt, p.emailInvitees)
		.run();
}

async function assign(surveyId: string, memberId: string, source: "invited" | "walk_in", completedAt: number | null = null) {
	await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id, source, completed_at) VALUES (?, ?, ?, ?)").bind(surveyId, memberId, source, completedAt).run();
}

describe("runFeedbackReminders", () => {
	beforeEach(async () => {
		for (const table of ["notifications", "email_deliveries", "email_campaigns", "email_categories", "email_senders", "survey_assignments", "surveys", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_admin", "mem_a", "mem_b", "mem_c", "mem_w"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, `${id}@example.com`, id, Date.now(), Date.now()).run();
		}
		await env.DB.prepare("INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt_1', 'General Assembly', 'official', 'Room', ?, 'd', 'mem_admin', 's')").bind(NOW.getTime() - 48 * HOUR).run();
	});

	it("reminds only invited non-responders, once", async () => {
		await seedSurvey("svy_1", { eventId: "evt_1" });
		await assign("svy_1", "mem_a", "invited", NOW.getTime() - HOUR);
		await assign("svy_1", "mem_b", "invited");
		await assign("svy_1", "mem_c", "invited");
		await assign("svy_1", "mem_w", "walk_in");

		expect(await runFeedbackReminders(db, noEmail)).toEqual({ surveys: 1, notified: 2, emailed: 0 });

		const rows = await db.select().from(notifications);
		expect(rows.map((r) => r.memberId).sort()).toEqual(["mem_b", "mem_c"]);
		expect(rows[0]).toMatchObject({ kind: "survey_reminder", title: "Reminder: feedback on General Assembly", href: "/portal/surveys/svy_1" });
		const [survey] = await db.select().from(surveys);
		expect(survey.reminderSentAt?.getTime()).toBe(NOW.getTime());

		expect((await runFeedbackReminders(db, noEmail)).surveys).toBe(0);
		expect(await db.select().from(notifications)).toHaveLength(2);
	});

	it("falls back to the survey title and writes no notifications when notifications are off", async () => {
		await seedSurvey("svy_1");
		await assign("svy_1", "mem_b", "invited");
		expect(await runFeedbackReminders(db, { ...noEmail, notificationsEnabled: false })).toEqual({ surveys: 1, notified: 0, emailed: 0 });
		expect(await db.select().from(notifications)).toHaveLength(0);
		// The claim still happened, so a later run with notifications on does not remind again.
		expect((await runFeedbackReminders(db, noEmail)).surveys).toBe(0);
	});

	it("uses the survey title when there is no event", async () => {
		await seedSurvey("svy_1");
		await assign("svy_1", "mem_b", "invited");
		await runFeedbackReminders(db, noEmail);
		const [row] = await db.select().from(notifications);
		expect(row.title).toBe("Reminder: feedback on Survey svy_1");
	});

	it("gives the form's own time estimate, not a fixed one", async () => {
		await seedSurvey("svy_1");
		await assign("svy_1", "mem_b", "invited");
		// Eight text questions at 45s each: 360s, which reads "About 6 min".
		await db.insert(surveyQuestions).values(
			Array.from({ length: 8 }, (_, i) => ({ id: `srvq_${i}`, surveyId: "svy_1", position: i + 1, type: "text" as const, prompt: `Q${i}` })),
		);
		await runFeedbackReminders(db, noEmail);
		const [row] = await db.select().from(notifications);
		expect(row.body).toBe("It takes about 6 min.");
	});

	it("falls back to the form's own title when the event title read fails, and still reminds every claimed form", async () => {
		await env.DB.prepare("INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt_2', 'Study Jam', 'official', 'Room', ?, 'd', 'mem_admin', 's')").bind(NOW.getTime() - 48 * HOUR).run();
		await seedSurvey("svy_1", { eventId: "evt_1" });
		await seedSurvey("svy_2", { eventId: "evt_2" });
		await assign("svy_1", "mem_b", "invited");
		await assign("svy_2", "mem_c", "invited");
		const brokenTitles = Object.assign(Object.create(db), {
			select: (fields?: Record<string, unknown>) => {
				if (fields?.title === schema.crsEvents.title) throw new Error("D1_ERROR: read failed");
				return fields ? db.select(fields as never) : db.select();
			},
		}) as typeof db;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			expect(await runFeedbackReminders(brokenTitles, noEmail)).toEqual({ surveys: 2, notified: 2, emailed: 0 });
			const rows = await db.select().from(notifications);
			expect(rows.map((row) => row.title).sort()).toEqual([expect.stringContaining("Survey svy_1"), expect.stringContaining("Survey svy_2")]);
			expect(logged).toHaveBeenCalledTimes(2);
		} finally {
			logged.mockRestore();
		}
	});

	it("skips closed, expired, not-yet-due, already-reminded and draft forms", async () => {
		await seedSurvey("svy_closed", { status: "closed" });
		await seedSurvey("svy_draft", { status: "draft" });
		await seedSurvey("svy_expired", { closesAt: NOW.getTime() });
		await seedSurvey("svy_early", { reminderAt: NOW.getTime() + 1 });
		await seedSurvey("svy_noreminder", { reminderAt: null });
		await seedSurvey("svy_done", { reminderSentAt: NOW.getTime() - HOUR });
		for (const id of ["svy_closed", "svy_draft", "svy_expired", "svy_early", "svy_noreminder", "svy_done"]) await assign(id, "mem_b", "invited");

		expect(await runFeedbackReminders(db, noEmail)).toEqual({ surveys: 0, notified: 0, emailed: 0 });
		expect(await db.select().from(notifications)).toHaveLength(0);
	});

	describe("email", () => {
		function fakeQueue() {
			const send = vi.fn(async () => {});
			return { queue: { send } as unknown as Queue<EmailJob>, send };
		}

		beforeEach(async () => {
			await env.DB.prepare("INSERT INTO email_senders (id, address, display_name) VALUES ('esnd_1', 'hello@ateneocode.org', 'CODE')").run();
			await env.DB.prepare("INSERT INTO email_categories (id, name, description, required, sort_order, default_sender_id) VALUES ('ecat_feedback', 'Feedback requests', '', 0, 90, 'esnd_1')").run();
		});

		it("queues one reminder campaign to all invitees when the form emails them", async () => {
			await seedSurvey("svy_1", { eventId: "evt_1", emailInvitees: 1 });
			await assign("svy_1", "mem_a", "invited", NOW.getTime() - HOUR);
			await assign("svy_1", "mem_b", "invited");
			const { queue, send } = fakeQueue();
			const deps = { now: NOW, notificationsEnabled: true, email: { queue, baseUrl: "https://beta.example.org" } };

			expect(await runFeedbackReminders(db, deps)).toEqual({ surveys: 1, notified: 1, emailed: 1 });

			const [campaign] = await db.select().from(emailCampaigns);
			expect(campaign.status).toBe("scheduled");
			expect(campaign.createdBy).toBe("mem_admin");
			expect(campaign.audience.include).toEqual([{ kind: "survey_invitees", surveyId: "svy_1" }]);
			expect(campaign.subject).toBe("Reminder: share feedback on General Assembly");
			expect(send).toHaveBeenCalledTimes(1);

			expect((await runFeedbackReminders(db, deps)).emailed).toBe(0);
			expect(await db.select().from(emailCampaigns)).toHaveLength(1);
		});

		it("sends no email when the form does not email invitees or email is off", async () => {
			await seedSurvey("svy_1", { emailInvitees: 0 });
			await seedSurvey("svy_2", { emailInvitees: 1 });
			await assign("svy_1", "mem_b", "invited");
			await assign("svy_2", "mem_b", "invited");
			const { queue, send } = fakeQueue();

			expect(await runFeedbackReminders(db, { now: NOW, notificationsEnabled: true, email: { queue, baseUrl: "https://beta.example.org" } })).toEqual({ surveys: 2, notified: 2, emailed: 1 });
			expect(send).toHaveBeenCalledTimes(1);

			await env.DB.prepare("UPDATE surveys SET reminder_sent_at = NULL").run();
			await db.delete(emailCampaigns);
			expect(await runFeedbackReminders(db, noEmail)).toEqual({ surveys: 2, notified: 2, emailed: 0 });
			expect(await db.select().from(emailCampaigns)).toHaveLength(0);
		});

		it("does not count an email when the feedback category has no sender", async () => {
			await env.DB.prepare("UPDATE email_categories SET default_sender_id = NULL").run();
			await seedSurvey("svy_1", { emailInvitees: 1 });
			await assign("svy_1", "mem_b", "invited");
			const { queue, send } = fakeQueue();
			expect(await runFeedbackReminders(db, { now: NOW, notificationsEnabled: true, email: { queue, baseUrl: "https://beta.example.org" } })).toEqual({ surveys: 1, notified: 1, emailed: 0 });
			expect(send).not.toHaveBeenCalled();
		});
	});
});
