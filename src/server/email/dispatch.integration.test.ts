import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { emailCampaigns, emailDeliveries } from "@/db/schema";
import type { Audience } from "@/lib/email/types";
import type { EmailConfig } from "./config";
import { runEmailDispatch } from "./dispatch";
import { queueEmailCampaign, runEmailJobs, type EmailJob } from "./jobs";
import { EmailQuotaError, type EmailSender, type OutgoingEmail } from "./sender";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-02T04:00:00Z");
const config: EmailConfig = {
	inboxAddress: "beta-inbox@ateneocode.org",
	publicBaseUrl: "https://beta.ateneocode.org",
	unsubscribeSecret: "test-unsubscribe-secret-0123456789",
	batchPerTick: 25,
	dailyCap: 300,
};

function fakeSender(fail: (message: OutgoingEmail) => Error | null = () => null) {
	const sent: OutgoingEmail[] = [];
	const sender: EmailSender = {
		async send(message) {
			const error = fail(message);
			if (error) throw error;
			sent.push(message);
			return { messageId: `msg-${sent.length}` };
		},
	};
	return { sender, sent };
}

async function seed(opts: { required?: boolean } = {}) {
	for (const table of ["email_deliveries", "email_campaigns", "email_optouts", "email_categories", "email_senders", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
	for (const id of ["mem_a", "mem_b", "mem_c"]) {
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name, batch, created_at, updated_at) VALUES (?, ?, ?, ?, '2027', ?, ?)")
			.bind(id, `${id}@example.com`, id, `${id.toUpperCase()} Person`, Date.now(), Date.now())
			.run();
	}
	await env.DB.prepare("INSERT INTO email_senders (id, address, display_name, created_at) VALUES ('esnd_1', 'hello@ateneocode.org', 'CODE', ?)").bind(Date.now()).run();
	await env.DB.prepare("INSERT INTO email_categories (id, name, description, required, sort_order, created_at) VALUES ('ecat_1', 'Newsletter', '', ?, 0, ?)")
		.bind(opts.required ? 1 : 0, Date.now())
		.run();
	await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id, created_at) VALUES ('mem_c', 'ecat_1', ?)").bind(Date.now()).run();
	await db.insert(emailCampaigns).values({
		id: "ecmp_1",
		categoryId: "ecat_1",
		senderId: "esnd_1",
		subject: "Hi {{first_name}}",
		preheader: "",
		blocks: [{ id: "t", type: "text", props: { text: "Hello {{first_name}}" } }],
		audience: { match: "any", include: [{ kind: "batch", batch: "2027" }], exclude: [] },
		status: "scheduled",
		scheduledAt: new Date(NOW.getTime() - 1000),
	});
}

const deliveries = () => db.select().from(emailDeliveries);
const campaign = async () => (await db.select().from(emailCampaigns))[0];

function jobBatch(campaignId = "ecmp_1") {
	const ack = vi.fn();
	return { ack, batch: { messages: [{ body: { campaignId }, ack }] } as unknown as MessageBatch<EmailJob> };
}

function fakeQueue() {
	const send = vi.fn().mockResolvedValue(undefined);
	return { send, queue: { send } as unknown as Queue<EmailJob> };
}

describe("queued email jobs", () => {
	beforeEach(() => seed());

	it("preserves Undo and longer scheduled dates, then sends without cron or duplicates", async () => {
		const { queue, send } = fakeQueue();
		const { sender, sent } = fakeSender();
		const at = new Date(NOW.getTime() + 120_000);
		await db.update(emailCampaigns).set({ scheduledAt: at }).where(eq(emailCampaigns.id, "ecmp_1"));
		await queueEmailCampaign(queue, "ecmp_1", at, NOW.getTime());
		expect(send).toHaveBeenLastCalledWith({ campaignId: "ecmp_1" }, { delaySeconds: 120 });
		const early = jobBatch();
		await runEmailJobs(early.batch, queue, db, sender, config, NOW);
		expect(sent).toHaveLength(0);
		expect(early.ack).toHaveBeenCalledOnce();
		await queueEmailCampaign(queue, "ecmp_1", new Date(NOW.getTime() + 3 * 86_400_000), NOW.getTime());
		expect(send).toHaveBeenLastCalledWith({ campaignId: "ecmp_1" }, { delaySeconds: 86_400 });
		await runEmailJobs(jobBatch().batch, queue, db, sender, config, at);
		expect(await campaign()).toMatchObject({ status: "sent", sentCount: 2 });
		await runEmailJobs(jobBatch().batch, queue, db, sender, config, at);
		expect(sent).toHaveLength(2);
	});

	it("continues batches and stops after Undo", async () => {
		const { queue, send } = fakeQueue();
		const { sender, sent } = fakeSender();
		await runEmailJobs(jobBatch().batch, queue, db, sender, { ...config, batchPerTick: 1 }, NOW);
		expect(sent).toHaveLength(1);
		expect(send).toHaveBeenLastCalledWith({ campaignId: "ecmp_1" }, { delaySeconds: 60 });
		await runEmailJobs(jobBatch().batch, queue, db, sender, config, new Date(NOW.getTime() + 60_000));
		expect(sent).toHaveLength(2);
		await db.update(emailCampaigns).set({ status: "draft" }).where(eq(emailCampaigns.id, "ecmp_1"));
		send.mockClear();
		await runEmailJobs(jobBatch().batch, queue, db, sender, config, NOW);
		expect(send).not.toHaveBeenCalled();
	});

	it("does not acknowledge a job if its next wake-up cannot be saved", async () => {
		const { queue, send } = fakeQueue();
		send.mockRejectedValueOnce(new Error("Queue unavailable"));
		const job = jobBatch();
		await expect(runEmailJobs(job.batch, queue, db, fakeSender().sender, { ...config, batchPerTick: 1 }, NOW)).rejects.toThrow("Queue unavailable");
		expect(job.ack).not.toHaveBeenCalled();
	});
});

describe("runEmailDispatch", () => {
	beforeEach(() => seed());

	it("uses recipient corrections in the real sending path and leaves profile data untouched", async () => {
		await db.update(emailCampaigns).set({ subject: "Hi {{firstname}}", mergeOverrides: { "mem_a@example.com": { first_name: "Ana <&>" } } }).where(eq(emailCampaigns.id, "ecmp_1"));
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		const email = sent.find((m) => m.to === "mem_a@example.com")!;
		expect(email.subject).toBe("Hi Ana <&>");
		expect(email.html).toContain("Hello Ana &lt;&amp;&gt;");
		expect(email.text).toContain("Hello Ana <&>");
		expect((await db.select().from(schema.members).where(eq(schema.members.id, "mem_a")))[0].fullName).toBe("MEM_A Person");
	});

	it("claims a due campaign, skips opted-out members, sends, and finishes", async () => {
		const { sender, sent } = fakeSender();
		const result = await runEmailDispatch(db, sender, config, NOW);
		expect(result).toMatchObject({ claimed: 1, sent: 2, failed: 0 });
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect(sent[0].subject).toMatch(/^Hi MEM_/);
		expect(sent[0].replyTo).toMatch(/^beta-inbox\+edl_[a-f0-9]+@ateneocode\.org$/);
		expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
		expect(sent[0].headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/beta\.ateneocode\.org\/api\/email\/unsubscribe\?t=/);
		const rows = await deliveries();
		expect(rows.find((r) => r.memberId === "mem_c")?.status).toBe("skipped_optout");
		expect(await campaign()).toMatchObject({ status: "sent", sentCount: 2, skippedCount: 1, recipientCount: 3 });
	});

	it("sends to opted-out members when the category is required, with no unsubscribe header", async () => {
		await seed({ required: true });
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent).toHaveLength(3);
		expect(sent[0].headers?.["List-Unsubscribe"]).toBeUndefined();
	});

	it("never double-sends when two ticks run at once", async () => {
		const { sender, sent } = fakeSender();
		await Promise.all([runEmailDispatch(db, sender, config, NOW), runEmailDispatch(db, sender, config, NOW)]);
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect((await deliveries()).length).toBe(3);
	});

	it("never double-sends already-enqueued rows when two ticks drain at once", async () => {
		await runEmailDispatch(db, fakeSender(() => new EmailQuotaError("daily limit")).sender, config, NOW);
		const { sender, sent } = fakeSender();
		await Promise.all([runEmailDispatch(db, sender, config, NOW), runEmailDispatch(db, sender, config, NOW)]);
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect(await campaign()).toMatchObject({ status: "sent", sentCount: 2 });
	});

	it("backs off on failure and fails after three attempts", async () => {
		const { sender } = fakeSender((m) => (m.to.startsWith("mem_a") ? new Error("mailbox unavailable") : null));
		await runEmailDispatch(db, sender, config, NOW);
		let row = (await deliveries()).find((r) => r.memberId === "mem_a")!;
		expect(row).toMatchObject({ status: "pending", attempts: 1, error: "mailbox unavailable" });
		expect(row.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 60_000);
		await runEmailDispatch(db, sender, config, new Date(NOW.getTime() + 61_000));
		await runEmailDispatch(db, sender, config, new Date(NOW.getTime() + 61_000 + 5 * 60_000 + 1000));
		row = (await deliveries()).find((r) => r.memberId === "mem_a")!;
		expect(row).toMatchObject({ status: "failed", attempts: 3 });
		expect((await campaign()).status).toBe("sent");
	});

	it("fails a delivery whose member was deleted after enqueue, without sending", async () => {
		await runEmailDispatch(db, fakeSender(() => new EmailQuotaError("daily limit")).sender, config, NOW);
		await env.DB.prepare("DELETE FROM members WHERE id = 'mem_a'").run();
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent.map((m) => m.to)).toEqual(["mem_b@example.com"]);
		const row = (await deliveries()).find((r) => r.email === "mem_a@example.com")!;
		expect(row).toMatchObject({ memberId: null, status: "failed", error: "Member no longer exists" });
	});

	it.each(["E_RECIPIENT_SUPPRESSED", "E_VALIDATION_ERROR", "E_SENDER_NOT_VERIFIED", "E_HEADER_TOO_LONG"])(
		"fails permanently without retry on %s",
		async (code) => {
			const { sender } = fakeSender((m) => (m.to.startsWith("mem_a") ? Object.assign(new Error("rejected"), { code }) : null));
			await runEmailDispatch(db, sender, config, NOW);
			const row = (await deliveries()).find((r) => r.memberId === "mem_a")!;
			expect(row).toMatchObject({ status: "failed", attempts: 1, nextAttemptAt: null });
		},
	);

	it("pauses on a quota error without spending an attempt", async () => {
		const { sender } = fakeSender(() => new EmailQuotaError("daily limit"));
		const result = await runEmailDispatch(db, sender, config, NOW);
		expect(result.paused).toBe(true);
		expect((await deliveries()).filter((r) => r.status === "pending").every((r) => r.attempts === 0)).toBe(true);
		expect((await campaign()).status).toBe("sending");
	});

	it("respects the daily cap", async () => {
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, { ...config, dailyCap: 1 }, NOW);
		expect(sent).toHaveLength(1);
	});

	it("does nothing before the scheduled time", async () => {
		const { sender, sent } = fakeSender();
		const result = await runEmailDispatch(db, sender, config, new Date(NOW.getTime() - 60_000));
		expect(result.claimed).toBe(0);
		expect(sent).toHaveLength(0);
	});

	it("recovers a claim whose enqueue never finished once the lease has expired", async () => {
		await db
			.update(emailCampaigns)
			.set({ status: "sending", updatedAt: new Date(NOW.getTime() - 16 * 60_000) })
			.where(eq(emailCampaigns.id, "ecmp_1"));
		await db.insert(emailDeliveries).values({ id: "edl_old", campaignId: "ecmp_1", memberId: "mem_a", email: "mem_a@example.com" });
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		const rows = await deliveries();
		expect(rows.map((r) => r.memberId).sort()).toEqual(["mem_a", "mem_b", "mem_c"]);
		expect(rows.find((r) => r.memberId === "mem_a")?.id).toBe("edl_old");
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect(await campaign()).toMatchObject({ status: "sent", sentCount: 2, skippedCount: 1 });
	});

	it("does not re-enqueue a fresh claim that another tick is still enqueueing", async () => {
		await db.update(emailCampaigns).set({ status: "sending", updatedAt: NOW }).where(eq(emailCampaigns.id, "ecmp_1"));
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(await deliveries()).toHaveLength(0);
		expect(sent).toHaveLength(0);
		expect((await campaign()).status).toBe("sending");
	});

	it("keeps sending other campaigns when one campaign's enqueue throws", async () => {
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
		await db.insert(emailCampaigns).values({
			id: "ecmp_broken",
			categoryId: "ecat_1",
			senderId: "esnd_1",
			subject: "Broken",
			// No exclude list: resolveAudience throws on it.
			audience: { match: "any", include: [{ kind: "batch", batch: "2027" }] } as unknown as Audience,
			status: "scheduled",
			scheduledAt: new Date(NOW.getTime() - 2000),
		});
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent.filter((m) => m.subject.startsWith("Hi "))).toHaveLength(2);
		expect(quiet).toHaveBeenCalled();
		quiet.mockRestore();
	});

	it("sends typed addresses to members and outside recipients, with a guest footer for outsiders", async () => {
		await db
			.update(emailCampaigns)
			.set({ audience: { match: "any", include: [{ kind: "emails", emails: ["mem_a@example.com", "guest@outside.org"] }], exclude: [] } })
			.where(eq(emailCampaigns.id, "ecmp_1"));
		const { sender, sent } = fakeSender();
		const result = await runEmailDispatch(db, sender, config, NOW);
		expect(result).toMatchObject({ sent: 2, failed: 0 });
		const guest = sent.find((m) => m.to === "guest@outside.org")!;
		expect(guest.headers?.["List-Unsubscribe"]).toBeUndefined();
		expect(guest.html).toContain("You received this email from CODE");
		expect(guest.html).not.toContain("/portal/mail/");
		expect(guest.replyTo).toMatch(/^beta-inbox\+edl_[a-f0-9]+@ateneocode\.org$/);
		expect(guest.subject).toBe("Hi there");
		const member = sent.find((m) => m.to === "mem_a@example.com")!;
		expect(member.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/beta\.ateneocode\.org\/api\/email\/unsubscribe\?t=/);
		const rows = await deliveries();
		expect(rows.find((r) => r.email === "guest@outside.org")).toMatchObject({ memberId: null, isExternal: true, status: "sent" });
		expect(rows.find((r) => r.email === "mem_a@example.com")).toMatchObject({ memberId: "mem_a", isExternal: false });
	});

	it("never skips an outside recipient as opted out", async () => {
		await db
			.update(emailCampaigns)
			.set({ audience: { match: "any", include: [{ kind: "emails", emails: ["mem_c@example.com", "guest@outside.org"] }], exclude: [] } })
			.where(eq(emailCampaigns.id, "ecmp_1"));
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent.map((m) => m.to)).toEqual(["guest@outside.org"]);
		expect((await deliveries()).find((r) => r.email === "mem_c@example.com")?.status).toBe("skipped_optout");
	});

	it("cancels pending rows left under a cancelled campaign", async () => {
		// A cancel that lands between the cron's claim and its enqueue leaves this state.
		await db.update(emailCampaigns).set({ status: "cancelled", startedAt: NOW }).where(eq(emailCampaigns.id, "ecmp_1"));
		await db.insert(emailDeliveries).values({ id: "edl_late", campaignId: "ecmp_1", memberId: "mem_a", email: "mem_a@example.com" });
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent).toHaveLength(0);
		expect((await deliveries()).map((r) => r.status)).toEqual(["cancelled"]);
	});
});
