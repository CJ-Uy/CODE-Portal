import { and, desc, eq, inArray } from "drizzle-orm";
import PostalMime from "postal-mime";
import { emailDeliveries, emailMessages, emailThreads, members } from "@/db/schema";
import type { EmailDb } from "@/db/repositories/email-audience";
import { createId } from "@/lib/ids";
import { plusTag } from "./config";
import { sanitizeEmailHtml } from "./sanitize";

export const MAX_INBOUND_BYTES = 5 * 1024 * 1024;

export function isAutoReply(headers: Map<string, string>): boolean {
	const auto = headers.get("auto-submitted")?.trim().toLowerCase();
	if (auto && auto !== "no") return true;
	if (/^(bulk|auto_reply|junk|list)$/i.test(headers.get("precedence")?.trim() ?? "")) return true;
	return headers.has("x-autoreply") || headers.has("x-autorespond");
}

const ids = (value: string | null | undefined) => (value ? (value.match(/<[^>]+>/g) ?? [value.trim()]) : []);

export async function handleInboundEmail(
	db: EmailDb,
	bucket: R2Bucket | null,
	raw: ArrayBuffer,
	envelope: { from: string; to: string },
	now = new Date(),
): Promise<{ threadId: string }> {
	const id = createId("emsg");
	const rawKey = `email/inbound/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.eml`;
	if (bucket) await bucket.put(rawKey, raw);

	let parsed: Awaited<ReturnType<typeof PostalMime.parse>> | null = null;
	try {
		parsed = await PostalMime.parse(raw);
		if (!parsed.from && !parsed.subject && !parsed.text && !parsed.html) parsed = null;
	} catch {
		parsed = null;
	}

	const headers = new Map((parsed?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
	const auto = isAutoReply(headers);
	const fromEmail = (parsed?.from?.address ?? envelope.from).trim().toLowerCase();
	const fromName = parsed?.from?.name?.trim() || null;
	const subject = parsed ? parsed.subject?.trim() || "(no subject)" : "(could not parse message)";
	const html = parsed?.html ? await sanitizeEmailHtml(parsed.html) : null;
	const text = parsed?.text ?? null;

	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, fromEmail)).limit(1);
	const tag = plusTag(envelope.to);
	let threadId: string | null = null;
	let campaignId: string | null = null;

	if (tag?.startsWith("eth_")) {
		// Only the thread's own correspondent may append; anyone else starts a new thread.
		const [thread] = await db
			.select({ id: emailThreads.id })
			.from(emailThreads)
			.where(and(eq(emailThreads.id, tag), eq(emailThreads.fromEmail, fromEmail)))
			.limit(1);
		threadId = thread?.id ?? null;
	} else if (tag?.startsWith("edl_")) {
		const [delivery] = await db.select({ campaignId: emailDeliveries.campaignId }).from(emailDeliveries).where(eq(emailDeliveries.id, tag)).limit(1);
		campaignId = delivery?.campaignId ?? null;
		if (campaignId) {
			const [thread] = await db
				.select({ id: emailThreads.id })
				.from(emailThreads)
				.where(and(eq(emailThreads.campaignId, campaignId), eq(emailThreads.fromEmail, fromEmail)))
				.orderBy(desc(emailThreads.lastMessageAt))
				.limit(1);
			threadId = thread?.id ?? null;
		}
	}
	if (!threadId) {
		const refs = [...ids(parsed?.inReplyTo), ...ids(parsed?.references)].slice(0, 20);
		if (refs.length > 0) {
			const [known] = await db.select({ threadId: emailMessages.threadId }).from(emailMessages).where(inArray(emailMessages.messageId, refs)).limit(1);
			threadId = known?.threadId ?? null;
		}
	}

	if (threadId) {
		const [existing] = await db.select({ unread: emailThreads.unread, isAuto: emailThreads.isAuto }).from(emailThreads).where(eq(emailThreads.id, threadId));
		await db
			.update(emailThreads)
			.set({ status: "open", unread: auto ? Boolean(existing?.unread) : true, isAuto: Boolean(existing?.isAuto) && auto, lastMessageAt: now })
			.where(eq(emailThreads.id, threadId));
	} else {
		threadId = createId("eth");
		await db.insert(emailThreads).values({
			id: threadId,
			campaignId,
			memberId: member?.id ?? null,
			fromEmail,
			fromName,
			subject,
			status: "open",
			unread: !auto,
			isAuto: auto,
			lastMessageAt: now,
			createdAt: now,
		});
	}

	await db.insert(emailMessages).values({
		id,
		threadId,
		direction: "in",
		messageId: parsed?.messageId ?? null,
		inReplyTo: parsed?.inReplyTo ?? null,
		referencesHeader: parsed?.references ?? null,
		fromEmail,
		toEmail: envelope.to.toLowerCase(),
		subject,
		text,
		html,
		rawKey: bucket ? rawKey : null,
		createdAt: now,
	});
	return { threadId };
}
