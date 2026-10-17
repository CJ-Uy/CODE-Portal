import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { InferInsertModel, SQL } from "drizzle-orm";
import { libraryItems, libraryListComments, libraryListItems, libraryListMembers, libraryLists, libraryReports, members } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { cardsByIds, memberLabel, notifyMembers, quietly } from "./library";
import type { Db, LibraryCard, LibraryCommentView, LibraryList } from "./library";
import { canSeeItem } from "./library-access";

export type ListRole = "owner" | "editor" | "viewer";

export type LibraryListSummary = Pick<LibraryList, "id" | "name" | "description" | "color" | "shared" | "isDefault" | "pinned" | "takenDownAt"> & {
	itemCount: number;
	role: ListRole;
};

export type LibraryListItemView =
	| { available: true; card: LibraryCard; note: string; addedByName: string | null; addedAt: Date; position: number }
	| { available: false; itemId: string; position: number };

export type LibraryListView = LibraryListSummary & {
	ownerName: string;
	moderationReason: string | null;
	/** Where a pinned list sits among the collections (lower first); only meaningful while it is pinned. */
	pinOrder: number;
	editors: { memberId: string; name: string }[];
	items: LibraryListItemView[];
};

export type LibraryListsRepository = {
	/** `owned` has the Saved list first, then newest first. `editable` is the lists others own that this member edits. */
	myLists(actor: Actor): Promise<{ owned: LibraryListSummary[]; editable: LibraryListSummary[] }>;
	/** Pinned, shared, not taken down, ordered by pinOrder. Open to any member. */
	collections(actor: Actor): Promise<LibraryListSummary[]>;
	/**
	 * Owner and editors always; anyone else only while the list is shared and not taken down. Null otherwise.
	 * Holders of library:moderate can also read (never change) a list that is taken down or has an open report.
	 */
	getList(actor: Actor, listId: string): Promise<LibraryListView | null>;
	/** Creates the member's "Saved" list (isDefault) on first use and returns its id. */
	ensureSaved(actor: Actor): Promise<string>;
	createList(actor: Actor, input: { name: string; description?: string }): Promise<string>;
	/** Owner. */
	updateList(actor: Actor, listId: string, input: { name?: string; description?: string; color?: string }): Promise<void>;
	/** Owner. Never the Saved list. */
	deleteList(actor: Actor, listId: string): Promise<void>;
	/** Owner. Sharing is refused while the list is taken down; turning it off also unpins it. */
	setShared(actor: Actor, listId: string, shared: boolean): Promise<void>;
	/** Owner. Adding someone who is already an editor does nothing. A new editor is notified. */
	addEditor(actor: Actor, listId: string, memberId: string): Promise<void>;
	/** The owner, or an editor removing themselves. */
	removeEditor(actor: Actor, listId: string, memberId: string): Promise<void>;
	/** Owner or editor. The item must be one the actor can see; it is appended at the end. Adding it twice does nothing. */
	addItem(actor: Actor, input: { listId: string; itemId: string; note?: string }): Promise<void>;
	/** Owner or editor. */
	removeItem(actor: Actor, input: { listId: string; itemId: string }): Promise<void>;
	/** Owner or editor. At most 2000 characters; an empty note clears it. */
	setNote(actor: Actor, input: { listId: string; itemId: string; note: string }): Promise<void>;
	/** Owner or editor. Unknown ids are ignored; rows not mentioned follow in their current order; positions end up 0..n-1. */
	reorder(actor: Actor, listId: string, itemIds: string[]): Promise<void>;
	/** Ids of the member's own lists and the lists they edit that contain the item. */
	savedIn(actor: Actor, itemId: string): Promise<string[]>;
	/** Empty when the actor cannot read the list (same rule as getList). Anonymous authors show as "Anonymous" to everyone except moderators. */
	listComments(actor: Actor, listId: string): Promise<LibraryCommentView[]>;
	/** Anyone who can open the list. The owner and the editors (not the commenter) are notified. */
	addComment(actor: Actor, input: { listId: string; parentId?: string | null; anonymous: boolean; body: string }): Promise<void>;
	/** library:moderate. */
	setCommentHidden(actor: Actor, commentId: string, hidden: boolean): Promise<void>;
	/** library:moderate. Only a shared list can be pinned. Without `pinOrder` a newly pinned list goes last. */
	setPinned(actor: Actor, listId: string, pinned: boolean, pinOrder?: number): Promise<void>;
	/** library:moderate. Records the reason, and unshares and unpins the list. Only a shared list, or one with an open report, can be taken down; any other reads as "List not found.". */
	takeDown(actor: Actor, listId: string, reason: string): Promise<void>;
	/** library:moderate. The list stays unshared: its owner chooses whether to share it again. */
	restore(actor: Actor, listId: string): Promise<void>;
};

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const NOTE_MAX = 2000;
const COMMENT_MAX = 4000;
const REASON_MAX = 500;
const COLOR = /^#[0-9a-f]{6}$/i;

const savedListId = (memberId: string) => `lst_saved_${memberId}`;

// Plain SQL for the same reason as library.ts: drizzle strips table prefixes from columns in a single-table select list.
const itemCountOf = sql<number>`(SELECT COUNT(*) FROM library_list_items li WHERE li.list_id = library_lists.id)`.mapWith(Number);
const listWithCount = { list: libraryLists, itemCount: itemCountOf };

const displayName = (row: { fullName: string | null; name: string | null }) => row.fullName || row.name || "Member";

function cleanName(name: string): string {
	const clean = name.trim().replace(/\s+/g, " ");
	if (!clean) throw new Error("A list name is required.");
	if (clean.length > NAME_MAX) throw new Error(`List names can be at most ${NAME_MAX} characters.`);
	return clean;
}

function cleanDescription(text: string): string {
	const clean = text.trim();
	if (clean.length > DESCRIPTION_MAX) throw new Error(`Descriptions can be at most ${DESCRIPTION_MAX} characters.`);
	return clean;
}

function cleanNote(text: string): string {
	const clean = text.trim();
	if (clean.length > NOTE_MAX) throw new Error(`Notes can be at most ${NOTE_MAX} characters.`);
	return clean;
}

function cleanReason(reason: string): string {
	const clean = reason.trim();
	if (!clean) throw new Error("A reason is required.");
	if (clean.length > REASON_MAX) throw new Error(`Reasons can be at most ${REASON_MAX} characters.`);
	return clean;
}

function requireModerator(actor: Actor): void {
	if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
}

function summaryOf(list: LibraryList, role: ListRole, itemCount: number): LibraryListSummary {
	return {
		id: list.id,
		name: list.name,
		description: list.description,
		color: list.color,
		shared: list.shared,
		isDefault: list.isDefault,
		pinned: list.pinned,
		takenDownAt: list.takenDownAt,
		itemCount,
		role,
	};
}

export function createLibraryListsRepository(db: Db, audit: AuditRepository): LibraryListsRepository {
	async function loadList(listId: string): Promise<LibraryList | null> {
		const [row] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId)).limit(1);
		return row ?? null;
	}

	async function requireList(listId: string): Promise<LibraryList> {
		const list = await loadList(listId);
		if (!list) throw new Error("List not found.");
		return list;
	}

	async function roleOf(actor: Actor, list: LibraryList): Promise<ListRole> {
		if (list.memberId === actor.memberId) return "owner";
		const [editor] = await db
			.select({ memberId: libraryListMembers.memberId })
			.from(libraryListMembers)
			.where(and(eq(libraryListMembers.listId, list.id), eq(libraryListMembers.memberId, actor.memberId)))
			.limit(1);
		return editor ? "editor" : "viewer";
	}

	/** The list and the actor's role in it, or null when the actor may not open it (or it does not exist). */
	async function openList(actor: Actor, listId: string): Promise<{ list: LibraryList; role: ListRole } | null> {
		const list = await loadList(listId);
		if (!list) return null;
		const role = await roleOf(actor, list);
		if (role === "viewer" && (!list.shared || list.takenDownAt)) return null;
		return { list, role };
	}

	/**
	 * openList, plus read-only sight for holders of library:moderate of a list that is taken down or has an open report.
	 * An ordinary unshared list stays closed to them. Writes keep using openList, so this never lets a moderator change anything.
	 */
	async function openListForReview(actor: Actor, listId: string): Promise<{ list: LibraryList; role: ListRole } | null> {
		const open = await openList(actor, listId);
		if (open || !can(actor, "library:moderate")) return open;
		const list = await loadList(listId);
		if (!list) return null;
		if (!list.takenDownAt && !(await hasOpenReport(listId))) return null;
		return { list, role: "viewer" };
	}

	async function hasOpenReport(listId: string): Promise<boolean> {
		const [report] = await db
			.select({ id: libraryReports.id })
			.from(libraryReports)
			.where(and(eq(libraryReports.listId, listId), isNull(libraryReports.resolvedAt)))
			.limit(1);
		return Boolean(report);
	}

	/** A list the actor may not open reads as missing, so nobody can probe for other members' private lists. */
	async function requireRole(actor: Actor, listId: string, needs: "owner" | "editor"): Promise<LibraryList> {
		const open = await openList(actor, listId);
		if (!open) throw new Error("List not found.");
		if (needs === "owner" && open.role !== "owner") throw new Error("Only the list owner can do that.");
		if (needs === "editor" && open.role === "viewer") throw new Error("Only the owner and editors can change this list.");
		return open.list;
	}

	async function editorListIds(actor: Actor): Promise<Set<string>> {
		const rows = await db.select({ listId: libraryListMembers.listId }).from(libraryListMembers).where(eq(libraryListMembers.memberId, actor.memberId));
		return new Set(rows.map((row) => row.listId));
	}

	async function audited(actor: Actor, action: string, list: LibraryList, detail?: string | null): Promise<void> {
		await audit.record(actor, {
			action,
			targetType: "library_list",
			targetId: list.id,
			category: "library",
			detail: `list=${list.name}${detail ? `; ${detail}` : ""}`,
			targetMemberId: list.memberId,
		});
	}

	return {
		async myLists(actor) {
			const [owned, editable] = await Promise.all([
				db
					.select(listWithCount)
					.from(libraryLists)
					.where(eq(libraryLists.memberId, actor.memberId))
					.orderBy(desc(libraryLists.isDefault), desc(libraryLists.createdAt), asc(libraryLists.id)),
				db
					.select(listWithCount)
					.from(libraryLists)
					.innerJoin(libraryListMembers, eq(libraryListMembers.listId, libraryLists.id))
					.where(eq(libraryListMembers.memberId, actor.memberId))
					.orderBy(desc(libraryListMembers.createdAt), asc(libraryLists.id)),
			]);
			return {
				owned: owned.map((row) => summaryOf(row.list, "owner", row.itemCount)),
				editable: editable.map((row) => summaryOf(row.list, "editor", row.itemCount)),
			};
		},

		async collections(actor) {
			const [rows, editing] = await Promise.all([
				db
					.select(listWithCount)
					.from(libraryLists)
					.where(and(eq(libraryLists.pinned, true), eq(libraryLists.shared, true), isNull(libraryLists.takenDownAt)))
					.orderBy(asc(libraryLists.pinOrder), asc(libraryLists.createdAt), asc(libraryLists.id)),
				editorListIds(actor),
			]);
			return rows.map(({ list, itemCount }) => summaryOf(list, list.memberId === actor.memberId ? "owner" : editing.has(list.id) ? "editor" : "viewer", itemCount));
		},

		async getList(actor, listId) {
			const open = await openListForReview(actor, listId);
			if (!open) return null;
			const { list, role } = open;
			const [[owner], editors, rows] = await Promise.all([
				db.select({ fullName: members.fullName, name: members.name }).from(members).where(eq(members.id, list.memberId)).limit(1),
				db
					.select({ memberId: libraryListMembers.memberId, fullName: members.fullName, name: members.name })
					.from(libraryListMembers)
					.innerJoin(members, eq(members.id, libraryListMembers.memberId))
					.where(eq(libraryListMembers.listId, listId))
					.orderBy(asc(libraryListMembers.createdAt), asc(libraryListMembers.memberId)),
				// Only the columns the visibility rules need: the cards of the visible items are fetched afterwards.
				db
					.select({
						itemId: libraryListItems.libraryItemId,
						note: libraryListItems.note,
						position: libraryListItems.position,
						addedAt: libraryListItems.createdAt,
						addedBy: libraryListItems.addedBy,
						addedByFullName: members.fullName,
						addedByName: members.name,
						status: libraryItems.status,
						confidentiality: libraryItems.confidentiality,
						createdBy: libraryItems.createdBy,
					})
					.from(libraryListItems)
					.innerJoin(libraryItems, eq(libraryItems.id, libraryListItems.libraryItemId))
					.leftJoin(members, eq(members.id, libraryListItems.addedBy))
					.where(eq(libraryListItems.listId, listId))
					.orderBy(asc(libraryListItems.position), asc(libraryListItems.createdAt), asc(libraryListItems.libraryItemId)),
			]);
			const cards = new Map((await cardsByIds(db, rows.filter((row) => canSeeItem(actor, row)).map((row) => row.itemId))).map((card) => [card.id, card]));
			const items = rows.map((row): LibraryListItemView => {
				const card = canSeeItem(actor, row) ? cards.get(row.itemId) : undefined;
				if (!card) return { available: false, itemId: row.itemId, position: row.position };
				return {
					available: true,
					card,
					note: row.note,
					addedByName: row.addedBy ? displayName({ fullName: row.addedByFullName, name: row.addedByName }) : null,
					addedAt: row.addedAt,
					position: row.position,
				};
			});
			return {
				...summaryOf(list, role, items.length),
				ownerName: owner ? displayName(owner) : "Member",
				moderationReason: list.moderationReason,
				pinOrder: list.pinOrder,
				editors: editors.map((editor) => ({ memberId: editor.memberId, name: displayName(editor) })),
				items,
			};
		},

		async ensureSaved(actor) {
			const id = savedListId(actor.memberId);
			// The primary key settles two first saves racing each other.
			await db.insert(libraryLists).values({ id, memberId: actor.memberId, name: "Saved", isDefault: true }).onConflictDoNothing();
			return id;
		},

		async createList(actor, input) {
			const name = cleanName(input.name);
			const description = cleanDescription(input.description ?? "");
			const id = createId("lst");
			await db.insert(libraryLists).values({ id, memberId: actor.memberId, name, description });
			return id;
		},

		async updateList(actor, listId, input) {
			await requireRole(actor, listId, "owner");
			const set: Partial<InferInsertModel<typeof libraryLists>> = { updatedAt: new Date() };
			if (input.name !== undefined) set.name = cleanName(input.name);
			if (input.description !== undefined) set.description = cleanDescription(input.description);
			if (input.color !== undefined) {
				// The color ends up in inline styles, so it has to be a plain hex value.
				if (!COLOR.test(input.color)) throw new Error("Use a color like #0c315c.");
				set.color = input.color.toLowerCase();
			}
			await db.update(libraryLists).set(set).where(eq(libraryLists.id, listId));
		},

		async deleteList(actor, listId) {
			const list = await requireRole(actor, listId, "owner");
			if (list.isDefault) throw new Error("The Saved list can't be deleted.");
			// Items, editors, comments and reports go with it through the foreign keys.
			await db.delete(libraryLists).where(eq(libraryLists.id, listId));
		},

		async setShared(actor, listId, shared) {
			await requireRole(actor, listId, "owner");
			// The takenDownAt guard sits in the write itself, so a takedown that lands between the read and the write still wins.
			const changed = await db
				.update(libraryLists)
				.set({ shared, ...(shared ? {} : { pinned: false }), updatedAt: new Date() })
				.where(and(eq(libraryLists.id, listId), shared ? isNull(libraryLists.takenDownAt) : undefined))
				.returning({ id: libraryLists.id });
			if (changed.length === 0) throw new Error("This list was taken down by a moderator, so it can't be shared.");
		},

		async addEditor(actor, listId, memberId) {
			const list = await requireRole(actor, listId, "owner");
			if (memberId === list.memberId) throw new Error("The owner already has full access to this list.");
			const [member] = await db
				.select({ id: members.id })
				.from(members)
				.where(and(eq(members.id, memberId), eq(members.status, "active")))
				.limit(1);
			if (!member) throw new Error("Member not found.");
			const added = await db
				.insert(libraryListMembers)
				.values({ listId, memberId, role: "editor" })
				.onConflictDoNothing()
				.returning({ memberId: libraryListMembers.memberId });
			// Only a new editor hears about it: adding someone twice must not send a second notification.
			if (added.length === 0) return;
			await quietly(async () =>
				notifyMembers(db, [memberId], actor.memberId, {
					kind: "library_list_editor",
					title: "You can now edit a list",
					body: `${await memberLabel(db, actor.memberId)} added you as an editor of "${list.name}".`,
					href: `/portal/library/lists/${listId}`,
				}),
			);
		},

		async removeEditor(actor, listId, memberId) {
			const open = await openList(actor, listId);
			if (!open) throw new Error("List not found.");
			if (open.role !== "owner" && !(open.role === "editor" && memberId === actor.memberId)) throw new Error("Only the list owner can remove editors.");
			await db.delete(libraryListMembers).where(and(eq(libraryListMembers.listId, listId), eq(libraryListMembers.memberId, memberId)));
		},

		async addItem(actor, input) {
			await requireRole(actor, input.listId, "editor");
			const note = cleanNote(input.note ?? "");
			const [item] = await db
				.select({ status: libraryItems.status, confidentiality: libraryItems.confidentiality, createdBy: libraryItems.createdBy })
				.from(libraryItems)
				.where(eq(libraryItems.id, input.itemId))
				.limit(1);
			if (!item || !canSeeItem(actor, item)) throw new Error("Library item not found.");
			// addedBy is always the actor: the "saved by N" count is the number of distinct people who added the item.
			// The position comes from the same statement as the insert, so two adds at once cannot pick the same slot.
			await db
				.insert(libraryListItems)
				.values({
					listId: input.listId,
					libraryItemId: input.itemId,
					note,
					addedBy: actor.memberId,
					position: sql`(SELECT COALESCE(MAX(position) + 1, 0) FROM library_list_items WHERE list_id = ${input.listId})`,
				})
				.onConflictDoNothing();
		},

		async removeItem(actor, input) {
			await requireRole(actor, input.listId, "editor");
			await db.delete(libraryListItems).where(and(eq(libraryListItems.listId, input.listId), eq(libraryListItems.libraryItemId, input.itemId)));
		},

		async setNote(actor, input) {
			await requireRole(actor, input.listId, "editor");
			const note = cleanNote(input.note);
			const changed = await db
				.update(libraryListItems)
				.set({ note })
				.where(and(eq(libraryListItems.listId, input.listId), eq(libraryListItems.libraryItemId, input.itemId)))
				.returning({ itemId: libraryListItems.libraryItemId });
			if (changed.length === 0) throw new Error("That item is not in this list.");
		},

		async reorder(actor, listId, itemIds) {
			await requireRole(actor, listId, "editor");
			const rows = await db
				.select({ itemId: libraryListItems.libraryItemId })
				.from(libraryListItems)
				.where(eq(libraryListItems.listId, listId))
				.orderBy(asc(libraryListItems.position), asc(libraryListItems.createdAt), asc(libraryListItems.libraryItemId));
			const current = rows.map((row) => row.itemId);
			const present = new Set(current);
			const requested = [...new Set(itemIds)].filter((id) => present.has(id));
			const named = new Set(requested);
			const order = [...requested, ...current.filter((id) => !named.has(id))];
			// Every row is rewritten, not just the ones that moved, so two editors reordering at once cannot leave a mix of
			// both orders behind: whichever batch commits last owns every position. Gaps from removals close up too.
			// ponytail: one UPDATE per row inside one batch. Fine for lists of a few hundred; past that, a single
			// UPDATE ... json_each(?) statement would do it in one round trip.
			const [first, ...rest] = order.map((itemId, position) =>
				db
					.update(libraryListItems)
					.set({ position })
					.where(and(eq(libraryListItems.listId, listId), eq(libraryListItems.libraryItemId, itemId))),
			);
			if (first) await db.batch([first, ...rest]);
		},

		async savedIn(actor, itemId) {
			const mine = db.select({ id: libraryLists.id }).from(libraryLists).where(eq(libraryLists.memberId, actor.memberId));
			const editing = db.select({ id: libraryListMembers.listId }).from(libraryListMembers).where(eq(libraryListMembers.memberId, actor.memberId));
			const rows = await db
				.select({ listId: libraryListItems.listId })
				.from(libraryListItems)
				.where(and(eq(libraryListItems.libraryItemId, itemId), or(inArray(libraryListItems.listId, mine), inArray(libraryListItems.listId, editing))))
				.orderBy(asc(libraryListItems.listId));
			return rows.map((row) => row.listId);
		},

		async listComments(actor, listId) {
			if (!(await openListForReview(actor, listId))) return [];
			const canModerate = can(actor, "library:moderate");
			const rows = await db
				.select({
					id: libraryListComments.id,
					parentId: libraryListComments.parentId,
					body: libraryListComments.body,
					hidden: libraryListComments.hidden,
					anonymous: libraryListComments.anonymous,
					createdAt: libraryListComments.createdAt,
					fullName: members.fullName,
					name: members.name,
				})
				.from(libraryListComments)
				.innerJoin(members, eq(members.id, libraryListComments.memberId))
				.where(eq(libraryListComments.listId, listId))
				.orderBy(asc(libraryListComments.createdAt), asc(libraryListComments.id));
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
					authorName: row.anonymous && !canModerate ? "Anonymous" : displayName(row),
				}));
		},

		async addComment(actor, input) {
			const body = input.body.trim();
			if (!body) throw new Error("Comment cannot be empty.");
			if (body.length > COMMENT_MAX) throw new Error(`Comments can be at most ${COMMENT_MAX} characters.`);
			const open = await openList(actor, input.listId);
			if (!open) throw new Error("List not found.");
			if (input.parentId) {
				const [parent] = await db
					.select({ id: libraryListComments.id })
					.from(libraryListComments)
					.where(and(eq(libraryListComments.id, input.parentId), eq(libraryListComments.listId, input.listId)))
					.limit(1);
				if (!parent) throw new Error("Comment not found.");
			}
			await db.insert(libraryListComments).values({
				id: createId("llc"),
				listId: input.listId,
				memberId: actor.memberId,
				parentId: input.parentId ?? null,
				anonymous: input.anonymous,
				body,
			});
			await quietly(async () => {
				const editors = await db.select({ memberId: libraryListMembers.memberId }).from(libraryListMembers).where(eq(libraryListMembers.listId, input.listId));
				// Anonymity holds here too: recipients are told that someone commented, not who.
				const who = input.anonymous ? "Someone" : await memberLabel(db, actor.memberId);
				await notifyMembers(db, [open.list.memberId, ...editors.map((editor) => editor.memberId)], actor.memberId, {
					kind: "library_comment",
					title: "New comment on your list",
					body: `${who} commented on "${open.list.name}".`,
					href: `/portal/library/lists/${input.listId}`,
				});
			});
		},

		async setCommentHidden(actor, commentId, hidden) {
			requireModerator(actor);
			const changed = await db.update(libraryListComments).set({ hidden }).where(eq(libraryListComments.id, commentId)).returning({ id: libraryListComments.id });
			if (changed.length === 0) throw new Error("Comment not found.");
			await audit.record(actor, {
				action: hidden ? "library:list_comment_hide" : "library:list_comment_unhide",
				targetType: "library_list_comment",
				targetId: commentId,
				category: "library",
			});
		},

		async setPinned(actor, listId, pinned, pinOrder) {
			requireModerator(actor);
			const list = await requireList(listId);
			if (pinned && (!list.shared || list.takenDownAt)) throw new Error("Only shared lists can be pinned.");
			if (pinOrder !== undefined && !Number.isInteger(pinOrder)) throw new Error("The pin order must be a whole number.");
			const set: { pinned: boolean; updatedAt: Date; pinOrder?: number | SQL } = { pinned, updatedAt: new Date() };
			if (pinOrder !== undefined) set.pinOrder = pinOrder;
			else if (pinned && !list.pinned) set.pinOrder = sql`(SELECT COALESCE(MAX(pin_order) + 1, 0) FROM library_lists WHERE pinned = 1)`;
			// The shared / taken-down guard sits in the write itself, so an unshare or takedown that lands between the read and the write still wins.
			const changed = await db
				.update(libraryLists)
				.set(set)
				.where(and(eq(libraryLists.id, listId), pinned ? and(eq(libraryLists.shared, true), isNull(libraryLists.takenDownAt)) : undefined))
				.returning({ id: libraryLists.id });
			if (changed.length === 0) throw new Error("Only shared lists can be pinned.");
			await audited(actor, pinned ? "library:list_pin" : "library:list_unpin", list);
		},

		async takeDown(actor, listId, reason) {
			requireModerator(actor);
			const why = cleanReason(reason);
			const list = await requireList(listId);
			if (list.takenDownAt) throw new Error("This list is already taken down.");
			// A taken-down list is readable by moderators, so only a list that is shared or under an open report may be taken down.
			// Otherwise a moderator could take down any private list (the Saved list id is predictable) just to read it.
			if (!list.shared && !(await hasOpenReport(listId))) throw new Error("List not found.");
			const now = new Date();
			const changed = await db
				.update(libraryLists)
				.set({ takenDownAt: now, moderationReason: why, shared: false, pinned: false, updatedAt: now })
				.where(and(eq(libraryLists.id, listId), isNull(libraryLists.takenDownAt)))
				.returning({ id: libraryLists.id });
			if (changed.length === 0) throw new Error("This list changed while you were working on it. Reload and try again.");
			await audited(actor, "library:list_take_down", list, why);
		},

		async restore(actor, listId) {
			requireModerator(actor);
			const list = await requireList(listId);
			if (!list.takenDownAt) throw new Error("This list is not taken down.");
			await db.update(libraryLists).set({ takenDownAt: null, moderationReason: null, updatedAt: new Date() }).where(eq(libraryLists.id, listId));
			await audited(actor, "library:list_restore", list);
		},
	};
}

export function createUnavailableLibraryListsRepository(): LibraryListsRepository {
	const unavailable = () => {
		throw new Error("Library lists are unavailable through this repository adapter.");
	};
	return {
		myLists: unavailable,
		collections: unavailable,
		getList: unavailable,
		ensureSaved: unavailable,
		createList: unavailable,
		updateList: unavailable,
		deleteList: unavailable,
		setShared: unavailable,
		addEditor: unavailable,
		removeEditor: unavailable,
		addItem: unavailable,
		removeItem: unavailable,
		setNote: unavailable,
		reorder: unavailable,
		savedIn: unavailable,
		listComments: unavailable,
		addComment: unavailable,
		setCommentHidden: unavailable,
		setPinned: unavailable,
		takeDown: unavailable,
		restore: unavailable,
	};
}
