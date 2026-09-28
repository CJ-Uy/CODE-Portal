import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsEvents, eventForumPosts, members } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

type ForumRow = InferSelectModel<typeof eventForumPosts>;

export type ForumAuthor = { memberId: string; fullName: string | null; name: string | null };
export type ForumPostView = {
	id: string;
	eventId: string;
	parentId: string | null;
	body: string;
	anonymous: boolean;
	createdAt: Date;
	author: ForumAuthor | null;
};
export type PostInput = { eventId: string; body: string; anonymous: boolean; parentId: string | null };

export type EventForumRepository = {
	post(actor: Actor, input: PostInput): Promise<ForumPostView>;
	listForEvent(actor: Actor, eventId: string, input?: { limit?: number; offset?: number }): Promise<ForumPostView[]>;
	revealAuthor(actor: Actor, postId: string): Promise<ForumAuthor>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function toView(row: ForumRow, author: ForumAuthor, canSeeAuthor: boolean): ForumPostView {
	const reveal = !row.anonymous || canSeeAuthor;
	return {
		id: row.id,
		eventId: row.eventId,
		parentId: row.parentId,
		body: row.body,
		anonymous: row.anonymous,
		createdAt: row.createdAt,
		author: reveal ? author : null,
	};
}

export function createEventForumRepository(db: Db, audit: AuditRepository): EventForumRepository {
	return {
		async post(actor, input) {
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, input.eventId)).limit(1);
			if (!event || event.deletedAt) throw new Error("Event not found.");
			// Informational events have no discussion thread. Existing posts stay readable.
			if (event.readOnly) throw new Error("This event does not have a discussion thread.");
			if (input.parentId) {
				const [parent] = await db
					.select({ eventId: eventForumPosts.eventId })
					.from(eventForumPosts)
					.where(eq(eventForumPosts.id, input.parentId))
					.limit(1);
				if (!parent || parent.eventId !== input.eventId) throw new Error("Parent post not found.");
			}
			const [row] = await db
				.insert(eventForumPosts)
				.values({
					id: createId("post"),
					eventId: input.eventId,
					memberId: actor.memberId,
					anonymous: input.anonymous,
					parentId: input.parentId,
					body: input.body,
				})
				.returning();
			const [me] = await db
				.select({ memberId: members.id, fullName: members.fullName, name: members.name })
				.from(members)
				.where(eq(members.id, actor.memberId))
				.limit(1);
			return toView(row, me, true);
		},

		async listForEvent(actor, eventId, input) {
			const canSeeAuthor = can(actor, "member:manage") && actor.roles.includes("super");
			const rows = await db
				.select({
					id: eventForumPosts.id,
					eventId: eventForumPosts.eventId,
					memberId: eventForumPosts.memberId,
					anonymous: eventForumPosts.anonymous,
					parentId: eventForumPosts.parentId,
					body: eventForumPosts.body,
					createdAt: eventForumPosts.createdAt,
					authorFullName: members.fullName,
					authorName: members.name,
				})
				.from(eventForumPosts)
				.innerJoin(members, eq(members.id, eventForumPosts.memberId))
				.where(eq(eventForumPosts.eventId, eventId))
				.orderBy(asc(eventForumPosts.createdAt))
				.limit(Math.min(input?.limit ?? 100, 100))
				.offset(input?.offset ?? 0);
			return rows.map((row: ForumRow & { authorFullName: string | null; authorName: string | null }) =>
				toView(row, { memberId: row.memberId, fullName: row.authorFullName, name: row.authorName }, canSeeAuthor),
			);
		},

		async revealAuthor(actor, postId) {
			if (!actor.roles.includes("super")) {
				throw new Error("Not authorized to reveal an anonymous author.");
			}
			const [row] = await db
				.select({ memberId: eventForumPosts.memberId, fullName: members.fullName, name: members.name })
				.from(eventForumPosts)
				.innerJoin(members, eq(members.id, eventForumPosts.memberId))
				.where(eq(eventForumPosts.id, postId))
				.limit(1);
			if (!row) throw new Error("Post not found.");
			await audit.record(actor, {
				action: "forum:reveal_author",
				targetType: "forum_post",
				targetId: postId,
				category: "event",
			});
			return { memberId: row.memberId, fullName: row.fullName, name: row.name };
		},
	};
}
