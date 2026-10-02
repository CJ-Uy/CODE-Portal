import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailMessages, emailThreads } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import type { EmailConfig } from "@/server/email/config";
import type { EmailSender, OutgoingEmail } from "@/server/email/sender";
import { createAuditRepository } from "./audit";
import { createEmailRepositories } from "./email";

const db = drizzle(env.DB, { schema });
const repos = createEmailRepositories(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_admin", roles: ["email"] };
const config: EmailConfig = {
	inboxAddress: "beta-inbox@ateneocode.org",
	publicBaseUrl: "https://example.org",
	unsubscribeSecret: "x".repeat(16),
	batchPerTick: 25,
	dailyCap: 300,
};

describe("inbox.reply", () => {
	beforeEach(async () => {
		for (const table of ["email_messages", "email_threads", "email_campaigns", "email_senders", "audit_logs", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('mem_admin', 'admin@example.com', 'Admin', ?, ?)").bind(Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_senders (id, address, display_name, created_at, archived_at) VALUES ('esn_old', 'old@ateneocode.org', 'Old', ?, ?)").bind(Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_senders (id, address, display_name, created_at) VALUES ('esn_new', 'events@ateneocode.org', 'CODE Events', ?)").bind(Date.now()).run();
		await env.DB.prepare(
			"INSERT INTO email_campaigns (id, subject, preheader, blocks, audience, status, sender_id, created_at, updated_at) VALUES ('ecmp_1', 'GA', '', '[]', '{\"match\":\"any\",\"include\":[],\"exclude\":[]}', 'sent', 'esn_old', ?, ?)",
		)
			.bind(Date.now(), Date.now())
			.run();
		await db.insert(emailThreads).values({ id: "eth_1", campaignId: "ecmp_1", fromEmail: "ana@example.com", fromName: "Ana", subject: "GA", lastMessageAt: new Date(), createdAt: new Date() });
		await db.insert(emailMessages).values({
			id: "emsg_1",
			threadId: "eth_1",
			direction: "in",
			messageId: "<m1@gmail.com>",
			fromEmail: "ana@example.com",
			toEmail: "beta-inbox@ateneocode.org",
			subject: "GA",
			text: "hi",
			createdAt: new Date(),
		});
	});

	it("sends to the thread sender with threading headers and stores the outbound message", async () => {
		const sent: OutgoingEmail[] = [];
		const sender: EmailSender = {
			async send(message) {
				sent.push(message);
				return { messageId: "<out1@ateneocode.org>" };
			},
		};
		await repos.inbox.reply(admin, "eth_1", "Thanks!", { sender, config });

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ to: "ana@example.com", replyTo: "beta-inbox+eth_1@ateneocode.org", subject: "Re: GA" });
		// The campaign's own sender is archived, so the first active sender is used.
		expect(sent[0].from).toEqual({ email: "events@ateneocode.org", name: "CODE Events" });
		expect(sent[0].headers?.["In-Reply-To"]).toBe("<m1@gmail.com>");
		expect(sent[0].headers?.References).toContain("<m1@gmail.com>");

		const out = (await db.select().from(emailMessages)).find((m) => m.direction === "out");
		expect(out).toMatchObject({ threadId: "eth_1", messageId: "<out1@ateneocode.org>", toEmail: "ana@example.com", sentBy: "mem_admin" });
	});
});
