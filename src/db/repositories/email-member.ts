import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members } from "@/db/schema";
import { mergeValuesFor, replaceTags } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Actor } from "@/server/auth/permissions";
import type { EmailDb } from "./email-audience";

export type ArchiveItem = {
	deliveryId: string;
	subject: string;
	preheader: string;
	categoryName: string | null;
	senderName: string | null;
	sentAt: Date | null;
	readAt: Date | null;
};
export type ReaderView = { deliveryId: string; subject: string; bodyHtml: string; categoryName: string; senderName: string | null; sentAt: Date | null };
export type PreferenceRow = { id: string; name: string; description: string; required: boolean; optedOut: boolean };

async function activeCategory(db: EmailDb, id: string) {
	const [row] = await db.select().from(emailCategories).where(and(eq(emailCategories.id, id), isNull(emailCategories.archivedAt))).limit(1);
	return row ?? null;
}

async function writeOptOut(db: EmailDb, memberId: string, categoryId: string, optedOut: boolean) {
	if (optedOut) await db.insert(emailOptouts).values({ memberId, categoryId }).onConflictDoNothing();
	else await db.delete(emailOptouts).where(and(eq(emailOptouts.memberId, memberId), eq(emailOptouts.categoryId, categoryId)));
}

async function requiredCategoryNames(db: EmailDb): Promise<string[]> {
	const rows = await db
		.select({ name: emailCategories.name })
		.from(emailCategories)
		.where(and(eq(emailCategories.required, true), isNull(emailCategories.archivedAt)))
		.orderBy(asc(emailCategories.sortOrder));
	return rows.map((r) => r.name);
}

/** Token opt-out from an email link. Returns null when the token no longer applies. */
export async function applyTokenOptOut(
	db: EmailDb,
	payload: { memberId: string; categoryId: string },
	optedOut: boolean,
): Promise<{ categoryName: string; requiredNames: string[] } | null> {
	const category = await activeCategory(db, payload.categoryId);
	if (!category || category.required) return null;
	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.id, payload.memberId)).limit(1);
	if (!member) return null;
	await writeOptOut(db, payload.memberId, payload.categoryId, optedOut);
	return { categoryName: category.name, requiredNames: await requiredCategoryNames(db) };
}

/** Read-only lookup for the unsubscribe page. GET requests never write, because link scanners prefetch them. */
export async function describeTokenCategory(
	db: EmailDb,
	payload: { memberId: string; categoryId: string },
): Promise<{ categoryName: string; requiredNames: string[]; optedOut: boolean } | null> {
	const category = await activeCategory(db, payload.categoryId);
	if (!category || category.required) return null;
	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.id, payload.memberId)).limit(1);
	if (!member) return null;
	const [optout] = await db
		.select({ memberId: emailOptouts.memberId })
		.from(emailOptouts)
		.where(and(eq(emailOptouts.memberId, payload.memberId), eq(emailOptouts.categoryId, payload.categoryId)))
		.limit(1);
	return { categoryName: category.name, requiredNames: await requiredCategoryNames(db), optedOut: Boolean(optout) };
}

export function createEmailMemberRepository(db: EmailDb) {
	return {
		async listArchive(actor: Actor): Promise<ArchiveItem[]> {
			const rows = await db
				.select({
					deliveryId: emailDeliveries.id,
					subject: emailCampaigns.subject,
					preheader: emailCampaigns.preheader,
					mergeOverrides: emailCampaigns.mergeOverrides,
					email: emailDeliveries.email,
					categoryName: emailCategories.name,
					senderName: emailSenders.displayName,
					sentAt: emailDeliveries.sentAt,
					readAt: emailDeliveries.readAt,
				})
				.from(emailDeliveries)
				.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
				.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
				.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
				.where(and(eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent")))
				.orderBy(desc(emailDeliveries.sentAt))
				.limit(200);
			const [member] = await db.select().from(members).where(eq(members.id, actor.memberId)).limit(1);
			return rows.map(({ mergeOverrides, email, ...r }) => {
				const values = mergeValuesFor({ ...(member ?? { name: null, fullName: null, nickname: null, batch: null }), email }, mergeOverrides);
				const merge = (text: string) => replaceTags(text, (tag) => values[tag]);
				return { ...r, subject: merge(r.subject), preheader: merge(r.preheader) };
			});
		},

		async unreadCount(actor: Actor): Promise<number> {
			const [row] = await db
				.select({ n: sql<number>`count(*)` })
				.from(emailDeliveries)
				.where(and(eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent"), isNull(emailDeliveries.readAt)));
			return Number(row?.n ?? 0);
		},

		async getForReader(actor: Actor, deliveryId: string, baseUrl: string): Promise<ReaderView | null> {
			const [row] = await db
				.select({ delivery: emailDeliveries, campaign: emailCampaigns, category: emailCategories, senderName: emailSenders.displayName })
				.from(emailDeliveries)
				.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
				.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
				.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
				.where(and(eq(emailDeliveries.id, deliveryId), eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent")))
				.limit(1);
			if (!row) return null;
			if (!row.delivery.readAt) await db.update(emailDeliveries).set({ readAt: new Date() }).where(eq(emailDeliveries.id, deliveryId));
			const [member] = await db.select().from(members).where(eq(members.id, actor.memberId)).limit(1);
			const values = mergeValuesFor({ ...(member ?? { name: null, fullName: null, nickname: null, batch: null }), email: row.delivery.email }, row.campaign.mergeOverrides);
			const categoryName = row.category?.name ?? "CODE";
			const rendered = renderEmail({
				subject: row.campaign.subject,
				preheader: row.campaign.preheader,
				blocks: row.campaign.blocks,
				resolve: valueResolver(values),
				values,
				baseUrl,
				footer: { categoryName, required: true, archiveUrl: null, preferencesUrl: `${baseUrl}/portal/mail/preferences`, unsubscribeUrl: null },
			});
			return { deliveryId, subject: rendered.subject, bodyHtml: rendered.bodyHtml, categoryName, senderName: row.senderName, sentAt: row.delivery.sentAt };
		},

		async listPreferences(actor: Actor): Promise<PreferenceRow[]> {
			const [categories, optouts] = await Promise.all([
				db.select().from(emailCategories).where(isNull(emailCategories.archivedAt)).orderBy(asc(emailCategories.sortOrder), asc(emailCategories.name)),
				db.select({ categoryId: emailOptouts.categoryId }).from(emailOptouts).where(eq(emailOptouts.memberId, actor.memberId)),
			]);
			const out = new Set(optouts.map((o) => o.categoryId));
			const rows = categories.map((c) => ({ id: c.id, name: c.name, description: c.description, required: c.required, optedOut: !c.required && out.has(c.id) }));
			return [...rows.filter((r) => r.required), ...rows.filter((r) => !r.required)];
		},

		async setOptOut(actor: Actor, categoryId: string, optedOut: boolean): Promise<void> {
			const category = await activeCategory(db, categoryId);
			if (!category) throw new Error("That category no longer exists.");
			if (category.required) throw new Error(`${category.name} is required for members and cannot be turned off.`);
			await writeOptOut(db, actor.memberId, categoryId, optedOut);
		},
	};
}
