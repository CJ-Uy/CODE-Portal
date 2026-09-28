import { and, asc, desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
	libraryComments,
	libraryFavorites,
	libraryItems,
	libraryListItems,
	libraryLists,
	members,
	type LibraryConfidentiality,
	type LibraryKind,
} from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type * as schema from "../schema";
import type { AuditRepository } from "./audit";

export type LibraryItem = InferSelectModel<typeof libraryItems>;
export type LibraryList = InferSelectModel<typeof libraryLists>;

export type LibraryItemInput = {
	kind: LibraryKind;
	confidentiality: LibraryConfidentiality;
	category: string;
	title: string;
	dek: string;
	readMinutes: number;
	abstract: string;
	sections: { heading: string; body: string }[];
	components: { name: string; definition: string; example: string }[];
	questions: string[];
	references: string[];
	topics: string[];
};

export type LibraryCommentView = {
	id: string;
	parentId: string | null;
	body: string;
	hidden: boolean;
	anonymous: boolean;
	createdAt: Date;
	authorName: string;
};

type Db = DrizzleD1Database<typeof schema>;

export type LibraryRepository = {
	listItems(actor: Actor, options?: { category?: string; q?: string; limit?: number }): Promise<LibraryItem[]>;
	getItem(actor: Actor, id: string): Promise<LibraryItem | null>;
	listAll(actor: Actor): Promise<LibraryItem[]>;
	createItem(actor: Actor, input: LibraryItemInput): Promise<LibraryItem>;
	updateItem(actor: Actor, id: string, input: LibraryItemInput): Promise<LibraryItem>;
	removeItem(actor: Actor, id: string): Promise<void>;
	listComments(actor: Actor, itemId: string): Promise<LibraryCommentView[]>;
	addComment(actor: Actor, input: { itemId: string; parentId?: string | null; anonymous: boolean; body: string }): Promise<void>;
	setCommentHidden(actor: Actor, commentId: string, hidden: boolean): Promise<void>;
	toggleFavorite(actor: Actor, itemId: string): Promise<boolean>;
	listFavorites(actor: Actor): Promise<LibraryItem[]>;
	createList(actor: Actor, input: { name: string; color: string }): Promise<LibraryList>;
	listLists(actor: Actor): Promise<LibraryList[]>;
	addToList(actor: Actor, input: { listId: string; itemId: string }): Promise<void>;
	removeFromList(actor: Actor, input: { listId: string; itemId: string }): Promise<void>;
	requestAccess(actor: Actor, itemId: string): Promise<void>;
};

function assertManage(actor: Actor): void {
	if (!can(actor, "library:manage")) throw new Error("Not authorized to manage the library.");
}

function visibleToActor(item: LibraryItem, canManage: boolean): boolean {
	return item.confidentiality !== "confidential" || canManage;
}

function toItemInsert(input: LibraryItemInput) {
	return {
		kind: input.kind,
		confidentiality: input.confidentiality,
		category: input.category,
		title: input.title,
		dek: input.dek,
		readMinutes: input.readMinutes,
		abstract: input.abstract,
		sectionsJson: input.sections,
		componentsJson: input.components,
		questionsJson: input.questions,
		referencesJson: input.references,
		topicsJson: input.topics,
	};
}

export function createLibraryRepository(db: Db, audit: AuditRepository): LibraryRepository {
	async function ownList(actor: Actor, listId: string) {
		const [list] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId)).limit(1);
		if (!list || list.memberId !== actor.memberId) throw new Error("List not found.");
		return list;
	}

	return {
		async listItems(actor, options) {
			const canManage = can(actor, "library:manage");
			const rows = await db.select().from(libraryItems).orderBy(desc(libraryItems.publishedAt)).limit(options?.limit ?? 100);
			const query = options?.q?.trim().toLowerCase();
			return rows.filter((item) => {
				if (!visibleToActor(item, canManage)) return false;
				if (options?.category && item.category !== options.category) return false;
				if (query) {
					const haystack = `${item.title} ${item.dek} ${item.topicsJson.join(" ")}`.toLowerCase();
					if (!haystack.includes(query)) return false;
				}
				return true;
			});
		},
		async getItem(actor, id) {
			const [row] = await db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
			if (!row) return null;
			return visibleToActor(row, can(actor, "library:manage")) ? row : null;
		},
		async listAll(actor) {
			assertManage(actor);
			return db.select().from(libraryItems).orderBy(desc(libraryItems.publishedAt));
		},
		async createItem(actor, input) {
			assertManage(actor);
			const [row] = await db
				.insert(libraryItems)
				.values({ id: createId("lib"), ...toItemInsert(input), createdBy: actor.memberId })
				.returning();
			await audit.record(actor, { action: "library:create", targetType: "library_item", targetId: row.id, category: "library" });
			return row;
		},
		async updateItem(actor, id, input) {
			assertManage(actor);
			const [row] = await db
				.update(libraryItems)
				.set({ ...toItemInsert(input), updatedAt: new Date() })
				.where(eq(libraryItems.id, id))
				.returning();
			if (!row) throw new Error("Library item not found.");
			await audit.record(actor, { action: "library:update", targetType: "library_item", targetId: row.id, category: "library" });
			return row;
		},
		async removeItem(actor, id) {
			assertManage(actor);
			await db.delete(libraryItems).where(eq(libraryItems.id, id));
			await audit.record(actor, { action: "library:delete", targetType: "library_item", targetId: id, category: "library" });
		},
		async listComments(actor, itemId) {
			const canModerate = can(actor, "library:moderate");
			const rows = await db
				.select({
					id: libraryComments.id,
					parentId: libraryComments.parentId,
					body: libraryComments.body,
					hidden: libraryComments.hidden,
					anonymous: libraryComments.anonymous,
					createdAt: libraryComments.createdAt,
					fullName: members.fullName,
					name: members.name,
				})
				.from(libraryComments)
				.innerJoin(members, eq(members.id, libraryComments.memberId))
				.where(eq(libraryComments.libraryItemId, itemId))
				.orderBy(asc(libraryComments.createdAt));
			return rows
				.filter((row) => canModerate || !row.hidden)
				.map((row) => ({
					id: row.id,
					parentId: row.parentId,
					body: row.body,
					hidden: row.hidden,
					anonymous: row.anonymous,
					createdAt: row.createdAt,
					// Anonymity hides identity from members but never from moderators.
					authorName: row.anonymous && !canModerate ? "Anonymous" : (row.fullName ?? row.name ?? "Member"),
				}));
		},
		async addComment(actor, input) {
			const body = input.body.trim();
			if (!body) throw new Error("Comment cannot be empty.");
			await db.insert(libraryComments).values({
				id: createId("lcm"),
				libraryItemId: input.itemId,
				memberId: actor.memberId,
				parentId: input.parentId ?? null,
				anonymous: input.anonymous,
				body,
			});
		},
		async setCommentHidden(actor, commentId, hidden) {
			if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate comments.");
			await db.update(libraryComments).set({ hidden }).where(eq(libraryComments.id, commentId));
			await audit.record(actor, {
				action: hidden ? "library:comment_hide" : "library:comment_unhide",
				targetType: "library_comment",
				targetId: commentId,
				category: "library",
			});
		},
		async toggleFavorite(actor, itemId) {
			const [existing] = await db
				.select()
				.from(libraryFavorites)
				.where(and(eq(libraryFavorites.memberId, actor.memberId), eq(libraryFavorites.libraryItemId, itemId)))
				.limit(1);
			if (existing) {
				await db
					.delete(libraryFavorites)
					.where(and(eq(libraryFavorites.memberId, actor.memberId), eq(libraryFavorites.libraryItemId, itemId)));
				return false;
			}
			await db.insert(libraryFavorites).values({ memberId: actor.memberId, libraryItemId: itemId });
			return true;
		},
		async listFavorites(actor) {
			const rows = await db
				.select({ item: libraryItems })
				.from(libraryFavorites)
				.innerJoin(libraryItems, eq(libraryItems.id, libraryFavorites.libraryItemId))
				.where(eq(libraryFavorites.memberId, actor.memberId))
				.orderBy(desc(libraryFavorites.createdAt));
			const canManage = can(actor, "library:manage");
			return rows.map((row) => row.item).filter((item) => visibleToActor(item, canManage));
		},
		async createList(actor, input) {
			const [row] = await db
				.insert(libraryLists)
				.values({ id: createId("lst"), memberId: actor.memberId, name: input.name, color: input.color })
				.returning();
			return row;
		},
		async listLists(actor) {
			return db
				.select()
				.from(libraryLists)
				.where(eq(libraryLists.memberId, actor.memberId))
				.orderBy(desc(libraryLists.createdAt));
		},
		async addToList(actor, input) {
			await ownList(actor, input.listId);
			await db
				.insert(libraryListItems)
				.values({ listId: input.listId, libraryItemId: input.itemId })
				.onConflictDoNothing();
		},
		async removeFromList(actor, input) {
			await ownList(actor, input.listId);
			await db
				.delete(libraryListItems)
				.where(and(eq(libraryListItems.listId, input.listId), eq(libraryListItems.libraryItemId, input.itemId)));
		},
		async requestAccess(actor, itemId) {
			// ponytail: record the request in the audit trail only. A notification fan-out
			// to library:manage holders lands with the notifications proxy work; the manual
			// grant flow is unchanged until then.
			await audit.record(actor, {
				action: "library:access_request",
				targetType: "library_item",
				targetId: itemId,
				category: "library",
			});
		},
	};
}

export function createUnavailableLibraryRepository(): LibraryRepository {
	const unavailable = () => {
		throw new Error("The library is unavailable through this repository adapter.");
	};
	return {
		listItems: unavailable,
		getItem: unavailable,
		listAll: unavailable,
		createItem: unavailable,
		updateItem: unavailable,
		removeItem: unavailable,
		listComments: unavailable,
		addComment: unavailable,
		setCommentHidden: unavailable,
		toggleFavorite: unavailable,
		listFavorites: unavailable,
		createList: unavailable,
		listLists: unavailable,
		addToList: unavailable,
		removeFromList: unavailable,
		requestAccess: unavailable,
	};
}
