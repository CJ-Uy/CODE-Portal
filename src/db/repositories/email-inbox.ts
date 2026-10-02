import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { emailCampaigns, emailMessages, emailSenders, emailThreads, memberRoles, members, roles } from "@/db/schema";
import { createId } from "@/lib/ids";
import { escapeHtml } from "@/lib/email/render";
import type { Actor } from "@/server/auth/permissions";
import { plusAddress, type EmailConfig } from "@/server/email/config";
import type { EmailSender } from "@/server/email/sender";
import type { AuditRepository } from "./audit";
import { memberDisplayName, type EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type ThreadListItem = {
	id: string;
	subject: string;
	fromEmail: string;
	fromName: string | null;
	memberName: string | null;
	campaignId: string | null;
	campaignSubject: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	status: "open" | "done";
	unread: boolean;
	isAuto: boolean;
	lastMessageAt: Date;
};
export type EmailMessageRow = InferSelectModel<typeof emailMessages>;
export type ThreadView = { thread: ThreadListItem; messages: EmailMessageRow[] };

const sender = alias(members, "sender_member");
const assignee = alias(members, "assignee_member");

export function createEmailInboxRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_thread", targetId, category: "email", detail: detail ?? null });

	const threadQuery = () =>
		db
			.select({
				thread: emailThreads,
				campaignSubject: emailCampaigns.subject,
				memberName: sender.name,
				memberFullName: sender.fullName,
				memberNickname: sender.nickname,
				memberEmail: sender.email,
				assigneeName: assignee.name,
				assigneeFullName: assignee.fullName,
				assigneeNickname: assignee.nickname,
				assigneeEmail: assignee.email,
			})
			.from(emailThreads)
			.leftJoin(emailCampaigns, eq(emailCampaigns.id, emailThreads.campaignId))
			.leftJoin(sender, eq(sender.id, emailThreads.memberId))
			.leftJoin(assignee, eq(assignee.id, emailThreads.assigneeId));

	type Row = Awaited<ReturnType<ReturnType<typeof threadQuery>["limit"]>>[number];
	const toItem = (r: Row): ThreadListItem => ({
		id: r.thread.id,
		subject: r.thread.subject,
		fromEmail: r.thread.fromEmail,
		fromName: r.thread.fromName,
		memberName: r.memberEmail ? memberDisplayName({ email: r.memberEmail, name: r.memberName, fullName: r.memberFullName, nickname: r.memberNickname }) : null,
		campaignId: r.thread.campaignId,
		campaignSubject: r.campaignSubject,
		assigneeId: r.thread.assigneeId,
		assigneeName: r.assigneeEmail
			? memberDisplayName({ email: r.assigneeEmail, name: r.assigneeName, fullName: r.assigneeFullName, nickname: r.assigneeNickname })
			: null,
		status: r.thread.status,
		unread: r.thread.unread,
		isAuto: r.thread.isAuto,
		lastMessageAt: r.thread.lastMessageAt,
	});

	return {
		async list(actor: Actor, opts: { folder: "open" | "done"; filter: "all" | "mine" | "unassigned" }): Promise<ThreadListItem[]> {
			assertEmail(actor, "email:send");
			const rows = await threadQuery()
				.where(
					and(
						eq(emailThreads.status, opts.folder),
						opts.filter === "mine" ? eq(emailThreads.assigneeId, actor.memberId) : undefined,
						opts.filter === "unassigned" ? isNull(emailThreads.assigneeId) : undefined,
					),
				)
				.orderBy(desc(emailThreads.lastMessageAt))
				.limit(200);
			return rows.map(toItem);
		},

		async get(actor: Actor, id: string): Promise<ThreadView | null> {
			assertEmail(actor, "email:send");
			const [row] = await threadQuery().where(eq(emailThreads.id, id)).limit(1);
			if (!row) return null;
			if (row.thread.unread) await db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, id));
			const messages = await db.select().from(emailMessages).where(eq(emailMessages.threadId, id)).orderBy(asc(emailMessages.createdAt));
			return { thread: { ...toItem(row), unread: false }, messages };
		},

		async reply(actor: Actor, threadId: string, body: string, deps: { sender: EmailSender; config: EmailConfig }): Promise<void> {
			assertEmail(actor, "email:send");
			const text = body.trim();
			if (!text) throw new Error("Write a reply first.");
			if (text.length > 20_000) throw new Error("That reply is too long.");
			const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, threadId)).limit(1);
			if (!thread) throw new Error("Conversation not found.");
			let [from] = thread.campaignId
				? await db
						.select({ address: emailSenders.address, displayName: emailSenders.displayName })
						.from(emailCampaigns)
						.innerJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
						.where(and(eq(emailCampaigns.id, thread.campaignId), isNull(emailSenders.archivedAt)))
						.limit(1)
				: [];
			if (!from) {
				[from] = await db
					.select({ address: emailSenders.address, displayName: emailSenders.displayName })
					.from(emailSenders)
					.where(isNull(emailSenders.archivedAt))
					.orderBy(asc(emailSenders.displayName))
					.limit(1);
			}
			if (!from) throw new Error("Add a sender in Email settings first.");
			const history = await db
				.select({ messageId: emailMessages.messageId, direction: emailMessages.direction })
				.from(emailMessages)
				.where(eq(emailMessages.threadId, threadId))
				.orderBy(asc(emailMessages.createdAt));
			const chain = history.map((m) => m.messageId).filter((m): m is string => Boolean(m));
			const lastInbound = [...history].reverse().find((m) => m.direction === "in" && m.messageId)?.messageId;
			const headers: Record<string, string> = {};
			if (lastInbound) headers["In-Reply-To"] = lastInbound;
			if (chain.length > 0) headers.References = chain.slice(-20).join(" ");
			const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
			const html = text
				.split(/\n{2,}/)
				.map((p) => `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
				.join("");
			const result = await deps.sender.send({
				to: thread.fromEmail,
				from: { email: from.address, name: from.displayName },
				replyTo: plusAddress(deps.config.inboxAddress, thread.id),
				subject,
				html,
				text,
				headers,
			});
			const now = new Date();
			await db.insert(emailMessages).values({
				id: createId("emsg"),
				threadId,
				direction: "out",
				messageId: result.messageId,
				inReplyTo: lastInbound ?? null,
				referencesHeader: headers.References ?? null,
				fromEmail: from.address,
				toEmail: thread.fromEmail,
				subject,
				text,
				html,
				sentBy: actor.memberId,
				createdAt: now,
			});
			await db.update(emailThreads).set({ lastMessageAt: now }).where(eq(emailThreads.id, threadId));
			await record(actor, "email:thread_reply", threadId);
		},

		async setStatus(actor: Actor, id: string, status: "open" | "done"): Promise<void> {
			assertEmail(actor, "email:send");
			await db.update(emailThreads).set({ status }).where(eq(emailThreads.id, id));
			await record(actor, status === "done" ? "email:thread_done" : "email:thread_reopen", id);
		},

		async assign(actor: Actor, id: string, assigneeId: string | null): Promise<void> {
			assertEmail(actor, "email:send");
			await db.update(emailThreads).set({ assigneeId }).where(eq(emailThreads.id, id));
			await record(actor, "email:thread_assign", id, assigneeId ?? "unassigned");
		},

		async listAssignees(actor: Actor): Promise<{ id: string; name: string }[]> {
			assertEmail(actor, "email:send");
			const rows = await db
				.selectDistinct({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname })
				.from(members)
				.innerJoin(memberRoles, eq(memberRoles.memberId, members.id))
				.innerJoin(roles, eq(roles.id, memberRoles.roleId))
				.where(inArray(roles.key, ["email", "super"]));
			return rows.map((r) => ({ id: r.id, name: memberDisplayName(r) })).sort((a, b) => a.name.localeCompare(b.name));
		},

		async openUnreadCount(actor: Actor): Promise<number> {
			assertEmail(actor, "email:send");
			const [row] = await db
				.select({ n: sql<number>`count(*)` })
				.from(emailThreads)
				.where(and(eq(emailThreads.status, "open"), eq(emailThreads.unread, true)));
			return Number(row?.n ?? 0);
		},
	};
}
