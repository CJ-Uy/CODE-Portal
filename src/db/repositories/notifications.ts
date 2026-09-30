import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Actor } from "@/server/auth/permissions";
import type * as schema from "@/db/schema";
import { isFeatureEnabled } from "@/server/features";

// The repository registry passes the getDb() handle, whose static type is the
// union of the sync better-sqlite3 and async D1 Drizzle databases. That union
// does not unify the query-builder overloads, so we narrow to the async D1
// shape (what production and the tests run on); the local better-sqlite3 handle
// is structurally compatible at runtime, matching the existing members repo.
type Db = DrizzleD1Database<typeof schema>;

export type NotificationKind = "event_approved" | "event_invite" | "survey_assigned" | "forum_reply" | "points_awarded";

export type FeedItem = {
	id: string;
	kind: NotificationKind;
	title: string;
	body: string;
	href: string | null;
	readAt: number | null;
	createdAt: number;
};

export type NotifyInput = {
	memberId: string;
	kind: NotificationKind;
	title: string;
	body: string;
	href?: string | null;
};

export type NotificationsRepository = {
	listFeed(actor: Actor, input?: { limit?: number }): Promise<FeedItem[]>;
	unreadCount(actor: Actor): Promise<number>;
	markRead(actor: Actor, id: string): Promise<void>;
	markAllRead(actor: Actor): Promise<void>;
};

function toMs(value: Date | number | null): number | null {
	if (value === null) return null;
	return value instanceof Date ? value.getTime() : value;
}

/**
 * Materialize one per-member notification row. This is a system side effect of
 * an already-authorized, already-audited action (event approval, survey
 * assignment, forum reply, points awarded), so it takes no actor and is not
 * itself audited. It is the ONLY write path for the notifications table.
 * Phase 7 Task 7 calls this from the event-approve and survey-assign
 * triggers; Phase 4's forum-reply and points-award write paths call it too.
 */
export async function notify(db: Db, input: NotifyInput): Promise<void> {
	if (!isFeatureEnabled("notifications")) return;
	await db.insert(notifications).values({
		id: createId("ntf"),
		memberId: input.memberId,
		kind: input.kind,
		title: input.title,
		body: input.body,
		href: input.href ?? null,
	});
}

export function createNotificationsRepository(db: Db): NotificationsRepository {
	return {
		async listFeed(actor, input) {
			const limit = Math.min(input?.limit ?? 25, 50);
			const rows = await db
				.select()
				.from(notifications)
				.where(eq(notifications.memberId, actor.memberId))
				// createdAt is millisecond-resolution, so two rows written in the same
				// tick tie. Break ties on the monotonic rowid so the most recently
				// inserted row sorts first and the feed stays deterministically newest-first.
				.orderBy(desc(notifications.createdAt), desc(sql`rowid`))
				.limit(limit);

			return rows.map((row) => ({
				id: row.id,
				kind: row.kind as NotificationKind,
				title: row.title,
				body: row.body,
				href: row.href,
				readAt: toMs(row.readAt),
				createdAt: toMs(row.createdAt) ?? 0,
			}));
		},

		async unreadCount(actor) {
			const rows = await db
				.select({ id: notifications.id })
				.from(notifications)
				.where(and(eq(notifications.memberId, actor.memberId), isNull(notifications.readAt)));
			return rows.length;
		},

		async markRead(actor, id) {
			await db
				.update(notifications)
				.set({ readAt: new Date() })
				.where(and(eq(notifications.id, id), eq(notifications.memberId, actor.memberId)));
		},

		async markAllRead(actor) {
			await db
				.update(notifications)
				.set({ readAt: new Date() })
				.where(and(eq(notifications.memberId, actor.memberId), isNull(notifications.readAt)));
		},
	};
}
