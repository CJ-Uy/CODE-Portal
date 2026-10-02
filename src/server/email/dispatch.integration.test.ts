import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailCampaigns, emailDeliveries } from "@/db/schema";
import type { EmailConfig } from "./config";
import { runEmailDispatch } from "./dispatch";
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

describe("runEmailDispatch", () => {
	beforeEach(() => seed());

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
