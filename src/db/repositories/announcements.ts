import { and, desc, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { announcementReads, announcements } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type * as schema from "../schema";
import type { AuditRepository } from "./audit";

export type Announcement = InferSelectModel<typeof announcements>;
export type AnnouncementFeedItem = Announcement & { unread: boolean };

export type AnnouncementInput = {
	tag: string;
	title: string;
	body: string;
	pinned: boolean;
	audience: string;
	linkedEventId?: string | null;
};

type Db = DrizzleD1Database<typeof schema>;

export type AnnouncementsRepository = {
	listForMember(actor: Actor, options?: { limit?: number }): Promise<AnnouncementFeedItem[]>;
	getById(actor: Actor, id: string): Promise<Announcement | null>;
	markRead(actor: Actor, id: string): Promise<void>;
	listAll(actor: Actor): Promise<Announcement[]>;
	create(actor: Actor, input: AnnouncementInput): Promise<Announcement>;
	update(actor: Actor, id: string, input: AnnouncementInput): Promise<Announcement>;
	remove(actor: Actor, id: string): Promise<void>;
};

function assertManage(actor: Actor): void {
	if (!can(actor, "announcement:manage")) {
		throw new Error("Not authorized to manage announcements.");
	}
}

export function createAnnouncementsRepository(db: Db, audit: AuditRepository): AnnouncementsRepository {
	return {
		async listForMember(actor, options) {
			const limit = options?.limit ?? 50;
			const rows = await db
				.select()
				.from(announcements)
				.orderBy(desc(announcements.pinned), desc(announcements.createdAt))
				.limit(limit);
			if (rows.length === 0) return [];
			const reads = await db
				.select({ id: announcementReads.announcementId })
				.from(announcementReads)
				.where(
					and(
						eq(announcementReads.memberId, actor.memberId),
						inArray(
							announcementReads.announcementId,
							rows.map((row) => row.id),
						),
					),
				);
			const readSet = new Set(reads.map((read) => read.id));
			return rows.map((row) => ({ ...row, unread: !readSet.has(row.id) }));
		},
		async getById(_actor, id) {
			const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
			return row ?? null;
		},
		async markRead(actor, id) {
			await db
				.insert(announcementReads)
				.values({ announcementId: id, memberId: actor.memberId })
				.onConflictDoNothing();
		},
		async listAll(actor) {
			assertManage(actor);
			return db.select().from(announcements).orderBy(desc(announcements.pinned), desc(announcements.createdAt));
		},
		async create(actor, input) {
			assertManage(actor);
			const [row] = await db
				.insert(announcements)
				.values({
					id: createId("ann"),
					tag: input.tag,
					title: input.title,
					body: input.body,
					pinned: input.pinned,
					audience: input.audience,
					linkedEventId: input.linkedEventId ?? null,
					createdBy: actor.memberId,
				})
				.returning();
			await audit.record(actor, {
				action: "announcement:create",
				targetType: "announcement",
				targetId: row.id,
				category: "announcement",
			});
			return row;
		},
		async update(actor, id, input) {
			assertManage(actor);
			const [row] = await db
				.update(announcements)
				.set({
					tag: input.tag,
					title: input.title,
					body: input.body,
					pinned: input.pinned,
					audience: input.audience,
					linkedEventId: input.linkedEventId ?? null,
					updatedAt: new Date(),
				})
				.where(eq(announcements.id, id))
				.returning();
			if (!row) throw new Error("Announcement not found.");
			await audit.record(actor, {
				action: "announcement:update",
				targetType: "announcement",
				targetId: row.id,
				category: "announcement",
			});
			return row;
		},
		async remove(actor, id) {
			assertManage(actor);
			await db.delete(announcements).where(eq(announcements.id, id));
			await audit.record(actor, {
				action: "announcement:delete",
				targetType: "announcement",
				targetId: id,
				category: "announcement",
			});
		},
	};
}

export function createUnavailableAnnouncementsRepository(): AnnouncementsRepository {
	const unavailable = () => {
		throw new Error("Announcements are unavailable through this repository adapter.");
	};
	return {
		listForMember: unavailable,
		getById: unavailable,
		markRead: unavailable,
		listAll: unavailable,
		create: unavailable,
		update: unavailable,
		remove: unavailable,
	};
}
