import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { crsEvents, emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members, roles, terms } from "@/db/schema";
import { audienceSchema, emailContentSchema } from "@/lib/email/blocks";
import { startOfUtc8Day } from "@/lib/date-slots";
import { createId } from "@/lib/ids";
import type { Audience, EmailBlock, EmailDeliveryStatus } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { chunk, memberDisplayName, resolveAudience, type EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type EmailCampaignRow = InferSelectModel<typeof emailCampaigns>;
export type CampaignInput = {
	id?: string;
	templateId: string | null;
	categoryId: string | null;
	senderId: string | null;
	subject: string;
	preheader: string;
	blocks: EmailBlock[];
	audience: Audience;
};
export type AudiencePreview = {
	matched: number;
	willReceive: number;
	optedOut: { memberId: string; name: string }[];
	recipients: { memberId: string; name: string; email: string }[];
};
export type AudienceOptions = {
	roles: { key: string; label: string }[];
	batches: string[];
	events: { id: string; title: string; startsAt: Date; place: string }[];
	currentTermName: string | null;
};
export type CampaignListItem = EmailCampaignRow & { categoryName: string | null; senderName: string | null };
export type HomeSummary = {
	sending: CampaignListItem[];
	scheduled: CampaignListItem[];
	recent: CampaignListItem[];
	drafts: CampaignListItem[];
	sentThisMonth: number;
	sentToday: number;
};
export type DeliveryRow = {
	id: string;
	memberId: string | null;
	email: string;
	name: string;
	status: EmailDeliveryStatus;
	attempts: number;
	error: string | null;
	sentAt: Date | null;
};
export type CampaignReport = { campaign: CampaignListItem; counts: Record<EmailDeliveryStatus, number>; deliveries: DeliveryRow[] };

const EVENT_WHEN = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatEventWhen = (date: Date) => EVENT_WHEN.format(date);

const ZERO_COUNTS: Record<EmailDeliveryStatus, number> = { pending: 0, sent: 0, failed: 0, skipped_optout: 0, cancelled: 0 };

export function createEmailCampaignsRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_campaign", targetId, category: "email", detail: detail ?? null });

	const listQuery = () =>
		db
			.select({ campaign: emailCampaigns, categoryName: emailCategories.name, senderName: emailSenders.displayName })
			.from(emailCampaigns)
			.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
			.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId));
	const flatten = (rows: { campaign: EmailCampaignRow; categoryName: string | null; senderName: string | null }[]): CampaignListItem[] =>
		rows.map((r) => ({ ...r.campaign, categoryName: r.categoryName, senderName: r.senderName }));

	async function get(actor: Actor, id: string): Promise<EmailCampaignRow | null> {
		assertEmail(actor, "email:send");
		const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
		return row ?? null;
	}

	async function snapshotEvents(blocks: EmailBlock[]): Promise<EmailBlock[]> {
		const ids = blocks.flatMap((b) => (b.type === "event" ? [b.props.eventId] : []));
		if (ids.length === 0) return blocks;
		const rows = await db
			.select({ id: crsEvents.id, title: crsEvents.title, startsAt: crsEvents.startsAt, place: crsEvents.place })
			.from(crsEvents)
			.where(and(inArray(crsEvents.id, ids), isNull(crsEvents.deletedAt)));
		const byId = new Map(rows.map((r) => [r.id, r]));
		return blocks.map((block) => {
			if (block.type !== "event") return block;
			const event = byId.get(block.props.eventId);
			if (!event) throw new Error("An event in this email was deleted. Remove that block and try again.");
			return { ...block, props: { ...block.props, title: event.title, when: formatEventWhen(event.startsAt), place: event.place } };
		});
	}

	async function optedOutIds(categoryId: string | null): Promise<Set<string>> {
		if (!categoryId) return new Set();
		const [category] = await db.select({ required: emailCategories.required }).from(emailCategories).where(eq(emailCategories.id, categoryId)).limit(1);
		if (!category || category.required) return new Set();
		const rows = await db.select({ memberId: emailOptouts.memberId }).from(emailOptouts).where(eq(emailOptouts.categoryId, categoryId));
		return new Set(rows.map((r) => r.memberId));
	}

	return {
		get,

		async saveDraft(actor: Actor, input: CampaignInput): Promise<EmailCampaignRow> {
			assertEmail(actor, "email:send");
			const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
			const audience = audienceSchema.parse(input.audience);
			const values = { templateId: input.templateId, categoryId: input.categoryId, senderId: input.senderId, ...content, audience, updatedAt: new Date() };
			if (!input.id) {
				const [row] = await db
					.insert(emailCampaigns)
					.values({ id: createId("ecmp"), ...values, createdBy: actor.memberId })
					.returning();
				await record(actor, "email:campaign_create", row.id, content.subject);
				return row;
			}
			const [row] = await db
				.update(emailCampaigns)
				.set({ ...values, status: "draft", scheduledAt: null })
				.where(and(eq(emailCampaigns.id, input.id), inArray(emailCampaigns.status, ["draft", "scheduled"])))
				.returning();
			if (!row) throw new Error("This email can no longer be edited. Duplicate it to send a new version.");
			return row;
		},

		async schedule(actor: Actor, id: string, at: Date, now = new Date()): Promise<EmailCampaignRow> {
			assertEmail(actor, "email:send");
			const campaign = await get(actor, id);
			if (!campaign) throw new Error("Email not found.");
			if (campaign.status !== "draft") throw new Error("Only drafts can be scheduled.");
			if (!campaign.senderId) throw new Error("Pick a sender before sending.");
			const [sender] = await db.select().from(emailSenders).where(eq(emailSenders.id, campaign.senderId)).limit(1);
			if (!sender || sender.archivedAt) throw new Error("The chosen sender is archived. Pick another sender.");
			if (!campaign.categoryId) throw new Error("Pick a category before sending.");
			const [category] = await db.select().from(emailCategories).where(eq(emailCategories.id, campaign.categoryId)).limit(1);
			if (!category || category.archivedAt) throw new Error("The chosen category is archived. Pick another category.");
			if (!campaign.subject.trim()) throw new Error("Add a subject before sending.");
			if (campaign.blocks.length === 0) throw new Error("Add content before sending.");
			if (campaign.audience.include.length === 0) throw new Error("Choose an audience before sending.");
			if (at.getTime() < now.getTime() - 60_000) throw new Error("Pick a time in the future.");
			const blocks = await snapshotEvents(campaign.blocks);
			const [row] = await db
				.update(emailCampaigns)
				.set({ status: "scheduled", scheduledAt: at, blocks, updatedAt: now })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "draft")))
				.returning();
			if (!row) throw new Error("Only drafts can be scheduled.");
			await record(actor, "email:campaign_schedule", id, at.toISOString());
			return row;
		},

		async unschedule(actor: Actor, id: string): Promise<void> {
			assertEmail(actor, "email:send");
			const rows = await db
				.update(emailCampaigns)
				.set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "scheduled")))
				.returning({ id: emailCampaigns.id });
			if (rows.length === 0) throw new Error("This email has already started sending.");
			await record(actor, "email:campaign_unschedule", id);
		},

		async cancel(actor: Actor, id: string): Promise<void> {
			assertEmail(actor, "email:send");
			const rows = await db
				.update(emailCampaigns)
				.set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "sending")))
				.returning({ id: emailCampaigns.id });
			if (rows.length === 0) throw new Error("Only an email that is sending can be cancelled.");
			// ponytail: a delivery already picked by the running cron tick can still go out; the window is one batch.
			await db
				.update(emailDeliveries)
				.set({ status: "cancelled" })
				.where(and(eq(emailDeliveries.campaignId, id), eq(emailDeliveries.status, "pending")));
			await record(actor, "email:campaign_cancel", id);
		},

		async retryFailed(actor: Actor, id: string): Promise<number> {
			assertEmail(actor, "email:send");
			const campaign = await get(actor, id);
			if (!campaign || !["sent", "failed"].includes(campaign.status)) throw new Error("Only finished emails can retry failed recipients.");
			const reset = await db
				.update(emailDeliveries)
				.set({ status: "pending", attempts: 0, error: null, nextAttemptAt: null })
				.where(and(eq(emailDeliveries.campaignId, id), eq(emailDeliveries.status, "failed")))
				.returning({ id: emailDeliveries.id });
			if (reset.length > 0) {
				await db.update(emailCampaigns).set({ status: "sending", finishedAt: null, updatedAt: new Date() }).where(eq(emailCampaigns.id, id));
				await record(actor, "email:campaign_retry", id, `${reset.length} recipients`);
			}
			return reset.length;
		},

		async duplicate(actor: Actor, id: string): Promise<EmailCampaignRow> {
			const source = await get(actor, id);
			if (!source) throw new Error("Email not found.");
			const [row] = await db
				.insert(emailCampaigns)
				.values({
					id: createId("ecmp"),
					templateId: source.templateId,
					categoryId: source.categoryId,
					senderId: source.senderId,
					subject: source.subject,
					preheader: source.preheader,
					blocks: source.blocks,
					audience: source.audience,
					createdBy: actor.memberId,
				})
				.returning();
			await record(actor, "email:campaign_duplicate", row.id, `from ${id}`);
			return row;
		},

		async previewAudience(actor: Actor, audience: Audience, categoryId: string | null, now = new Date()): Promise<AudiencePreview> {
			assertEmail(actor, "email:send");
			const recipients = await resolveAudience(db, audienceSchema.parse(audience), now);
			const optedOut = await optedOutIds(categoryId);
			const receiving = recipients.filter((r) => !optedOut.has(r.memberId));
			return {
				matched: recipients.length,
				willReceive: receiving.length,
				optedOut: recipients.filter((r) => optedOut.has(r.memberId)).map((r) => ({ memberId: r.memberId, name: memberDisplayName(r) })),
				recipients: receiving.slice(0, 50).map((r) => ({ memberId: r.memberId, name: memberDisplayName(r), email: r.email })),
			};
		},

		async audienceOptions(actor: Actor, now = new Date()): Promise<AudienceOptions> {
			assertEmail(actor, "email:send");
			const [roleRows, batchRows, eventRows, termRows] = await Promise.all([
				db.select({ key: roles.key, label: roles.label }).from(roles).orderBy(asc(roles.label)),
				db.selectDistinct({ batch: members.batch }).from(members).orderBy(desc(members.batch)),
				db
					.select({ id: crsEvents.id, title: crsEvents.title, startsAt: crsEvents.startsAt, place: crsEvents.place })
					.from(crsEvents)
					.where(isNull(crsEvents.deletedAt))
					.orderBy(desc(crsEvents.startsAt))
					.limit(60),
				db
					.select({ name: terms.name })
					.from(terms)
					.where(and(sql`${terms.startsAt} <= ${now.getTime()}`, sql`${terms.endsAt} >= ${now.getTime()}`))
					.limit(1),
			]);
			return {
				roles: roleRows.filter((r) => r.key !== "member"),
				batches: batchRows.map((r) => r.batch).filter((b): b is string => Boolean(b)),
				events: eventRows,
				currentTermName: termRows[0]?.name ?? null,
			};
		},

		async searchMembers(actor: Actor, query: string) {
			assertEmail(actor, "email:send");
			const q = query.trim();
			if (q.length < 2) return [];
			const pattern = `%${q}%`;
			const rows = await db
				.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname, batch: members.batch })
				.from(members)
				.where(or(like(members.name, pattern), like(members.fullName, pattern), like(members.nickname, pattern), like(members.email, pattern)))
				.limit(12);
			return rows.map((r) => ({ id: r.id, name: memberDisplayName(r), email: r.email, batch: r.batch }));
		},

		async labelsFor(actor: Actor, ids: string[]): Promise<Record<string, string>> {
			assertEmail(actor, "email:send");
			const labels: Record<string, string> = {};
			for (const part of chunk(ids, 90)) {
				const rows = await db
					.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname })
					.from(members)
					.where(inArray(members.id, part));
				for (const row of rows) labels[row.id] = memberDisplayName(row);
			}
			return labels;
		},

		async home(actor: Actor, now = new Date()): Promise<HomeSummary> {
			assertEmail(actor, "email:send");
			const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
			const [sending, scheduled, recent, drafts, [month], [today]] = await Promise.all([
				listQuery().where(eq(emailCampaigns.status, "sending")).orderBy(asc(emailCampaigns.startedAt)),
				listQuery().where(eq(emailCampaigns.status, "scheduled")).orderBy(asc(emailCampaigns.scheduledAt)),
				listQuery()
					.where(inArray(emailCampaigns.status, ["sent", "failed", "cancelled"]))
					.orderBy(desc(emailCampaigns.finishedAt))
					.limit(5),
				listQuery().where(eq(emailCampaigns.status, "draft")).orderBy(desc(emailCampaigns.updatedAt)).limit(10),
				db
					.select({ n: sql<number>`count(*)` })
					.from(emailDeliveries)
					.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, monthStart))),
				db
					.select({ n: sql<number>`count(*)` })
					.from(emailDeliveries)
					.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, startOfUtc8Day(now)))),
			]);
			return {
				sending: flatten(sending),
				scheduled: flatten(scheduled),
				recent: flatten(recent),
				drafts: flatten(drafts),
				sentThisMonth: Number(month?.n ?? 0),
				sentToday: Number(today?.n ?? 0),
			};
		},

		async report(actor: Actor, id: string, opts?: { status?: EmailDeliveryStatus; q?: string }): Promise<CampaignReport | null> {
			assertEmail(actor, "email:send");
			const [campaignRow] = await listQuery().where(eq(emailCampaigns.id, id)).limit(1);
			if (!campaignRow) return null;
			const countRows = await db
				.select({ status: emailDeliveries.status, n: sql<number>`count(*)` })
				.from(emailDeliveries)
				.where(eq(emailDeliveries.campaignId, id))
				.groupBy(emailDeliveries.status);
			const counts = { ...ZERO_COUNTS };
			for (const row of countRows) counts[row.status] = Number(row.n);
			const q = opts?.q?.trim();
			const rows = await db
				.select({ delivery: emailDeliveries, name: members.name, fullName: members.fullName, nickname: members.nickname })
				.from(emailDeliveries)
				.leftJoin(members, eq(members.id, emailDeliveries.memberId))
				.where(
					and(
						eq(emailDeliveries.campaignId, id),
						opts?.status ? eq(emailDeliveries.status, opts.status) : undefined,
						q ? or(like(emailDeliveries.email, `%${q}%`), like(members.name, `%${q}%`), like(members.fullName, `%${q}%`)) : undefined,
					),
				)
				.orderBy(asc(emailDeliveries.email))
				.limit(500);
			return {
				campaign: flatten([campaignRow])[0],
				counts,
				deliveries: rows.map((r) => ({
					id: r.delivery.id,
					memberId: r.delivery.memberId,
					email: r.delivery.email,
					name: memberDisplayName({ email: r.delivery.email, name: r.name, fullName: r.fullName, nickname: r.nickname }),
					status: r.delivery.status,
					attempts: r.delivery.attempts,
					error: r.delivery.error,
					sentAt: r.delivery.sentAt,
				})),
			};
		},
	};
}
