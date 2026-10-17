import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { emailCampaigns } from "@/db/schema";
import type { EmailJob } from "@/server/email/jobs";
import { feedbackEmailReady, queueFeedbackEmail } from "./email";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-16T04:00:00Z");
const input = { surveyId: "svy_1", createdBy: "mem_admin", title: "GA", closesAt: new Date("2026-10-19T12:00:00Z"), estimate: "About 2 min", baseUrl: "https://beta.example.org", now: NOW };

function fakeQueue() {
	const send = vi.fn(async () => {});
	return { queue: { send } as unknown as Queue<EmailJob>, send };
}

describe("queueFeedbackEmail", () => {
	beforeEach(async () => {
		for (const table of ["email_deliveries", "email_campaigns", "email_categories", "email_senders", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('mem_admin', 'a@example.com', 'a', ?, ?)").bind(Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_senders (id, address, display_name) VALUES ('esnd_1', 'hello@ateneocode.org', 'CODE')").run();
		await env.DB.prepare("INSERT INTO email_categories (id, name, description, required, sort_order) VALUES ('ecat_feedback', 'Feedback requests', '', 0, 90)").run();
	});

	it("reports not ready and queues nothing without a default sender", async () => {
		const { queue, send } = fakeQueue();
		expect(await feedbackEmailReady(db)).toBe(false);
		expect(await queueFeedbackEmail(db, queue, { ...input, kind: "invite" })).toBe("no_sender");
		expect(send).not.toHaveBeenCalled();
		expect(await db.select().from(emailCampaigns)).toHaveLength(0);
	});

	it("schedules the campaign two minutes out and queues it", async () => {
		await env.DB.prepare("UPDATE email_categories SET default_sender_id='esnd_1' WHERE id='ecat_feedback'").run();
		const { queue, send } = fakeQueue();
		expect(await feedbackEmailReady(db)).toBe(true);
		expect(await queueFeedbackEmail(db, queue, { ...input, kind: "reminder" })).toBe("queued");
		const [campaign] = await db.select().from(emailCampaigns);
		expect(campaign.status).toBe("scheduled");
		expect(campaign.scheduledAt?.getTime()).toBe(NOW.getTime() + 120_000);
		expect(campaign.subject).toBe("Reminder: share feedback on GA");
		expect(JSON.stringify(campaign.blocks)).toContain("it takes about 2 min");
		expect(JSON.stringify(campaign.blocks)).toContain("https://beta.example.org/portal/surveys/svy_1");
		expect(send).toHaveBeenCalledTimes(1);
		const calls = send.mock.calls as unknown as [EmailJob, { delaySeconds: number }][];
		expect(calls[0][0]).toEqual({ campaignId: campaign.id });
		expect(calls[0][1].delaySeconds).toBe(120);
	});

	it("keeps the campaign scheduled and reports queued when the queue send throws", async () => {
		await env.DB.prepare("UPDATE email_categories SET default_sender_id='esnd_1' WHERE id='ecat_feedback'").run();
		const send = vi.fn(async () => {
			throw new Error("queue down");
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await queueFeedbackEmail(db, { send } as unknown as Queue<EmailJob>, { ...input, kind: "invite" })).toBe("queued");
			const rows = await db.select().from(emailCampaigns);
			expect(rows).toHaveLength(1);
			expect(rows[0].status).toBe("scheduled");
			expect(send).toHaveBeenCalledTimes(1);
			expect(error).toHaveBeenCalledTimes(1);
			expect(String(error.mock.calls[0][0])).toContain(rows[0].id);
		} finally {
			error.mockRestore();
		}
	});
});
