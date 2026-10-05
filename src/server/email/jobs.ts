import { eq } from "drizzle-orm";
import type { EmailDb } from "@/db/repositories/email-audience";
import { emailCampaigns } from "@/db/schema";
import type { EmailConfig } from "./config";
import { runEmailDispatch } from "./dispatch";
import type { EmailSender } from "./sender";

export type EmailJob = { campaignId: string };

export async function queueEmailCampaign(queue: Queue<EmailJob>, campaignId: string, at = new Date(), now = Date.now()) {
	// Queues supports at most a day's delay. The consumer checks the saved date again.
	const delaySeconds = Math.min(86_400, Math.max(0, Math.ceil((at.getTime() - now) / 1000)));
	await queue.send({ campaignId }, { delaySeconds });
}

export async function runEmailJobs(batch: MessageBatch<unknown>, queue: Queue<EmailJob>, db: EmailDb, sender: EmailSender, config: EmailConfig, now = new Date()) {
	for (const message of batch.messages) {
		const id = (message.body as { campaignId?: unknown } | null)?.campaignId;
		if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid email campaign job.");
		const campaign = async () => (await db.select({ status: emailCampaigns.status, scheduledAt: emailCampaigns.scheduledAt }).from(emailCampaigns).where(eq(emailCampaigns.id, id)))[0];
		let row = await campaign();
		if (!row || (row.status !== "scheduled" && row.status !== "sending")) {
			message.ack();
			continue;
		}
		let paused = false;
		if (row.status === "sending" || (row.scheduledAt && row.scheduledAt <= now)) {
			const result = await runEmailDispatch(db, sender, config, now);
			console.log("email job dispatch", JSON.stringify(result));
			paused = result.paused;
			row = await campaign();
		}
		if (row?.status === "scheduled" || row?.status === "sending") {
			const at = row.status === "scheduled" && row.scheduledAt && row.scheduledAt > now
				? row.scheduledAt
				: new Date(now.getTime() + (paused ? 3_600_000 : 60_000));
			// Publish the next wake-up before acknowledging this one so failures stay retryable.
			await queueEmailCampaign(queue, id, at, now.getTime());
		}
		message.ack();
	}
}
