import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailMessages, emailThreads } from "@/db/schema";
import { handleInboundEmail, isAutoReply } from "./inbound";

const db = drizzle(env.DB, { schema });
const encode = (text: string) => new TextEncoder().encode(text.replaceAll("\n", "\r\n")).buffer as ArrayBuffer;

const mail = (opts: { from: string; to: string; subject: string; body: string; extra?: string }) =>
	encode(
		`From: Ana Member <${opts.from}>\nTo: ${opts.to}\nSubject: ${opts.subject}\nMessage-ID: <${crypto.randomUUID()}@gmail.com>\n${opts.extra ?? ""}Content-Type: text/plain; charset=utf-8\n\n${opts.body}\n`,
	);

describe("handleInboundEmail", () => {
	beforeEach(async () => {
		for (const table of ["email_messages", "email_threads", "email_deliveries", "email_campaigns", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('mem_a', 'ana@example.com', 'Ana', ?, ?)").bind(Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_campaigns (id, subject, preheader, blocks, audience, status, created_at, updated_at) VALUES ('ecmp_1', 'GA', '', '[]', '{\"match\":\"any\",\"include\":[],\"exclude\":[]}', 'sent', ?, ?)")
			.bind(Date.now(), Date.now())
			.run();
		await env.DB.prepare("INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts) VALUES ('edl_1', 'ecmp_1', 'mem_a', 'ana@example.com', 'sent', 1)").run();
	});

	it("threads a plus-addressed reply to its campaign and member", async () => {
		const raw = mail({ from: "ana@example.com", to: "beta-inbox+edl_1@ateneocode.org", subject: "Re: GA", body: "Count me in" });
		const { threadId } = await handleInboundEmail(db, null, raw, { from: "ana@example.com", to: "beta-inbox+edl_1@ateneocode.org" });
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ id: threadId, campaignId: "ecmp_1", memberId: "mem_a", status: "open", unread: true, isAuto: false });
		const [message] = await db.select().from(emailMessages);
		expect(message.text?.trim()).toBe("Count me in");
	});

	it("appends a second reply from the same person to the same thread", async () => {
		const to = "beta-inbox+edl_1@ateneocode.org";
		const first = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to, subject: "Re: GA", body: "one" }), { from: "ana@example.com", to });
		const second = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to, subject: "Re: GA", body: "two" }), { from: "ana@example.com", to });
		expect(second.threadId).toBe(first.threadId);
		expect(await db.select().from(emailMessages)).toHaveLength(2);
	});

	it("starts a new thread for an untagged mail from a stranger", async () => {
		const to = "beta-inbox@ateneocode.org";
		await handleInboundEmail(db, null, mail({ from: "stranger@else.com", to, subject: "Hello", body: "hi" }), { from: "stranger@else.com", to });
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ campaignId: null, memberId: null, fromEmail: "stranger@else.com" });
	});

	it("flags auto-replies and keeps them read", async () => {
		const to = "beta-inbox+edl_1@ateneocode.org";
		await handleInboundEmail(
			db,
			null,
			mail({ from: "ana@example.com", to, subject: "Out of office", body: "away", extra: "Auto-Submitted: auto-replied\n" }),
			{ from: "ana@example.com", to },
		);
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ isAuto: true, unread: false });
	});

	it("does not append to an eth_ thread when the sender is a different address", async () => {
		const first = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to: "beta-inbox+edl_1@ateneocode.org", subject: "Re: GA", body: "one" }), {
			from: "ana@example.com",
			to: "beta-inbox+edl_1@ateneocode.org",
		});
		const to = `beta-inbox+${first.threadId}@ateneocode.org`;
		const second = await handleInboundEmail(db, null, mail({ from: "mallory@else.com", to, subject: "Re: GA", body: "injected" }), { from: "mallory@else.com", to });
		expect(second.threadId).not.toBe(first.threadId);
		expect(await db.select().from(emailThreads)).toHaveLength(2);
		const own = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to, subject: "Re: GA", body: "two" }), { from: "ana@example.com", to });
		expect(own.threadId).toBe(first.threadId);
	});

	it("keeps an unparseable message", async () => {
		const to = "beta-inbox@ateneocode.org";
		const { threadId } = await handleInboundEmail(db, null, new Uint8Array([0, 1, 2]).buffer as ArrayBuffer, { from: "x@y.com", to });
		expect(threadId).toBeTruthy();
	});
});

describe("isAutoReply", () => {
	it("reads the standard headers", () => {
		expect(isAutoReply(new Map([["auto-submitted", "no"]]))).toBe(false);
		expect(isAutoReply(new Map([["precedence", "bulk"]]))).toBe(true);
		expect(isAutoReply(new Map([["x-autoreply", "yes"]]))).toBe(true);
	});
});
