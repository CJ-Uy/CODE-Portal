import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members } from "@/db/schema";
import { chunk, resolveAudience, type EmailDb } from "@/db/repositories/email-audience";
import { startOfUtc8Day } from "@/lib/date-slots";
import { createId } from "@/lib/ids";
import { mergeValuesFor } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Audience } from "@/lib/email/types";
import { plusAddress, type EmailConfig } from "./config";
import { EmailQuotaError, type EmailSender } from "./sender";
import { signUnsubscribeToken } from "./unsubscribe-token";

export type DispatchResult = { claimed: number; sent: number; failed: number; paused: boolean };

const BACKOFF_MINUTES = [1, 5, 15];
const MAX_ATTEMPTS = 3;
// How long a picked row stays hidden from other ticks. A tick that dies mid-send retries the row after this.
const CLAIM_MINUTES = 10;
// A delivery insert binds 5 columns; 15 rows stays under D1's 100-parameter limit.
const INSERT_CHUNK = 15;
const ID_CHUNK = 90;

export async function unsubscribeLinks(config: EmailConfig, memberId: string, categoryId: string) {
	const token = await signUnsubscribeToken(config.unsubscribeSecret, memberId, categoryId);
	return {
		page: `${config.publicBaseUrl}/unsubscribe?t=${token}`,
		oneClick: `${config.publicBaseUrl}/api/email/unsubscribe?t=${token}`,
	};
}

async function enqueue(db: EmailDb, campaign: { id: string; audience: Audience; categoryId: string | null }, now: Date) {
	const recipients = await resolveAudience(db, campaign.audience, now);
	const [category] = campaign.categoryId
		? await db.select({ required: emailCategories.required }).from(emailCategories).where(eq(emailCategories.id, campaign.categoryId)).limit(1)
		: [];
	const optedOut =
		category && !category.required && campaign.categoryId
			? new Set(
					(await db.select({ memberId: emailOptouts.memberId }).from(emailOptouts).where(eq(emailOptouts.categoryId, campaign.categoryId))).map(
						(r) => r.memberId,
					),
				)
			: new Set<string>();
	const rows = recipients.map((r) => ({
		id: createId("edl"),
		campaignId: campaign.id,
		memberId: r.memberId,
		email: r.email,
		status: optedOut.has(r.memberId) ? ("skipped_optout" as const) : ("pending" as const),
	}));
	for (const part of chunk(rows, INSERT_CHUNK)) await db.insert(emailDeliveries).values(part).onConflictDoNothing();
}

async function claimDueCampaigns(db: EmailDb, now: Date): Promise<number> {
	// `sending` with no startedAt means a claim whose enqueue never finished (crashed tick). Enqueue is idempotent, so redo it.
	const due = await db
		.select({ id: emailCampaigns.id, status: emailCampaigns.status, audience: emailCampaigns.audience, categoryId: emailCampaigns.categoryId })
		.from(emailCampaigns)
		.where(
			or(
				and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.scheduledAt, now)),
				and(eq(emailCampaigns.status, "sending"), isNull(emailCampaigns.startedAt)),
			),
		);
	let claimed = 0;
	for (const campaign of due) {
		if (campaign.status === "scheduled") {
			// The conditional update is the lock: only the tick that flips the row claims it.
			const flipped = await db
				.update(emailCampaigns)
				.set({ status: "sending", updatedAt: now })
				.where(and(eq(emailCampaigns.id, campaign.id), eq(emailCampaigns.status, "scheduled")))
				.returning({ id: emailCampaigns.id });
			if (flipped.length === 0) continue;
			claimed++;
		}
		await enqueue(db, campaign, now);
		// startedAt marks the audience as fully enqueued. finish() leaves the campaign alone until it is set.
		await db
			.update(emailCampaigns)
			.set({ startedAt: now })
			.where(and(eq(emailCampaigns.id, campaign.id), isNull(emailCampaigns.startedAt)));
	}
	return claimed;
}

async function drain(db: EmailDb, sender: EmailSender, config: EmailConfig, now: Date) {
	const [{ n: sentToday }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(emailDeliveries)
		.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, startOfUtc8Day(now))));
	const budget = Math.min(config.batchPerTick, config.dailyCap - Number(sentToday));
	if (budget <= 0) return { sent: 0, failed: 0, paused: true };

	const due = await db
		.select({ delivery: emailDeliveries })
		.from(emailDeliveries)
		.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
		.where(
			and(
				eq(emailDeliveries.status, "pending"),
				eq(emailCampaigns.status, "sending"),
				or(isNull(emailDeliveries.nextAttemptAt), lte(emailDeliveries.nextAttemptAt, now)),
			),
		)
		.orderBy(asc(emailCampaigns.startedAt), asc(emailDeliveries.id))
		.limit(budget);
	if (due.length === 0) return { sent: 0, failed: 0, paused: false };

	const campaignIds = [...new Set(due.map((d) => d.delivery.campaignId))];
	const campaignRows = await db
		.select({ campaign: emailCampaigns, category: emailCategories, sender: emailSenders })
		.from(emailCampaigns)
		.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
		.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
		.where(inArray(emailCampaigns.id, campaignIds));
	const campaigns = new Map(campaignRows.map((r) => [r.campaign.id, r]));

	const memberIds = due.map((d) => d.delivery.memberId).filter((id): id is string => id !== null);
	const memberRows = [];
	for (const part of chunk(memberIds, ID_CHUNK)) {
		memberRows.push(
			...(await db
				.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname, batch: members.batch })
				.from(members)
				.where(inArray(members.id, part))),
		);
	}
	const memberById = new Map(memberRows.map((m) => [m.id, m]));

	let sent = 0;
	let failed = 0;
	for (const { delivery } of due) {
		// Per-row lock against an overlapping tick that selected the same rows. Success and failure overwrite nextAttemptAt.
		const claim = await db
			.update(emailDeliveries)
			.set({ nextAttemptAt: new Date(now.getTime() + CLAIM_MINUTES * 60_000) })
			.where(
				and(
					eq(emailDeliveries.id, delivery.id),
					eq(emailDeliveries.status, "pending"),
					or(isNull(emailDeliveries.nextAttemptAt), lte(emailDeliveries.nextAttemptAt, now)),
				),
			)
			.returning({ id: emailDeliveries.id });
		if (claim.length === 0) continue;
		const entry = campaigns.get(delivery.campaignId);
		const fail = async (message: string, final: boolean) => {
			const attempts = delivery.attempts + 1;
			const done = final || attempts >= MAX_ATTEMPTS;
			await db
				.update(emailDeliveries)
				.set({
					attempts,
					error: message,
					status: done ? "failed" : "pending",
					nextAttemptAt: done ? null : new Date(now.getTime() + BACKOFF_MINUTES[attempts - 1] * 60_000),
				})
				.where(eq(emailDeliveries.id, delivery.id));
			if (done) failed++;
		};
		if (!entry?.sender || !entry.category) {
			await fail("The sender or category for this email no longer exists.", true);
			continue;
		}
		const member = delivery.memberId ? memberById.get(delivery.memberId) : undefined;
		const values = mergeValuesFor(member ?? { email: delivery.email, name: null, fullName: null, nickname: null, batch: null });
		const links =
			!entry.category.required && delivery.memberId ? await unsubscribeLinks(config, delivery.memberId, entry.category.id) : null;
		const rendered = renderEmail({
			subject: entry.campaign.subject,
			preheader: entry.campaign.preheader,
			blocks: entry.campaign.blocks,
			resolve: valueResolver(values),
			values,
			baseUrl: config.publicBaseUrl,
			footer: {
				categoryName: entry.category.name,
				required: entry.category.required,
				archiveUrl: `${config.publicBaseUrl}/portal/mail/${delivery.id}`,
				preferencesUrl: `${config.publicBaseUrl}/portal/mail/preferences`,
				unsubscribeUrl: links?.page ?? null,
			},
		});
		const headers: Record<string, string> = { "X-CODE-Campaign": entry.campaign.id };
		if (links) {
			headers["List-Unsubscribe"] = `<${links.oneClick}>`;
			headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
		}
		try {
			const result = await sender.send({
				to: delivery.email,
				from: { email: entry.sender.address, name: entry.sender.displayName },
				replyTo: plusAddress(config.inboxAddress, delivery.id),
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
				headers,
			});
			await db
				.update(emailDeliveries)
				.set({ status: "sent", messageId: result.messageId, sentAt: now, attempts: delivery.attempts + 1, error: null, nextAttemptAt: null })
				.where(eq(emailDeliveries.id, delivery.id));
			sent++;
		} catch (error) {
			if (error instanceof EmailQuotaError) {
				await db.update(emailDeliveries).set({ nextAttemptAt: delivery.nextAttemptAt }).where(eq(emailDeliveries.id, delivery.id));
				return { sent, failed, paused: true };
			}
			await fail(error instanceof Error ? error.message : String(error), false);
		}
	}
	return { sent, failed, paused: false };
}

async function finish(db: EmailDb, now: Date) {
	// A cancel that lands between a claim and its enqueue leaves pending rows under a cancelled campaign.
	await db
		.update(emailDeliveries)
		.set({ status: "cancelled" })
		.where(
			and(
				eq(emailDeliveries.status, "pending"),
				inArray(emailDeliveries.campaignId, db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.status, "cancelled"))),
			),
		);
	const sending = await db
		.select({ id: emailCampaigns.id })
		.from(emailCampaigns)
		.where(and(eq(emailCampaigns.status, "sending"), isNotNull(emailCampaigns.startedAt)));
	for (const { id } of sending) {
		const rows = await db
			.select({ status: emailDeliveries.status, n: sql<number>`count(*)` })
			.from(emailDeliveries)
			.where(eq(emailDeliveries.campaignId, id))
			.groupBy(emailDeliveries.status);
		const count = (status: string) => Number(rows.find((r) => r.status === status)?.n ?? 0);
		const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
		const counts = { recipientCount: total, sentCount: count("sent"), failedCount: count("failed"), skippedCount: count("skipped_optout") };
		if (count("pending") > 0) {
			await db.update(emailCampaigns).set(counts).where(eq(emailCampaigns.id, id));
			continue;
		}
		const status = counts.failedCount > 0 && counts.sentCount === 0 ? "failed" : "sent";
		await db
			.update(emailCampaigns)
			.set({ ...counts, status, finishedAt: now, updatedAt: now })
			.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "sending")));
	}
}

export async function runEmailDispatch(db: EmailDb, sender: EmailSender, config: EmailConfig, now = new Date()): Promise<DispatchResult> {
	const claimed = await claimDueCampaigns(db, now);
	const drained = await drain(db, sender, config, now);
	await finish(db, now);
	return { claimed, ...drained };
}
