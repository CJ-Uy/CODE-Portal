import { asc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { libraryItems, libraryItemTags, libraryTags } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { refreshSearchText } from "./library";
import type { Db } from "./library";
import { canEditItem } from "./library-access";

export type LibraryTag = { id: string; name: string; groupName: string; itemCount: number };

export type LibraryTagsRepository = {
	/** Ordered by group, then name. itemCount only counts items every member can browse (published, not confidential). */
	listTags(): Promise<LibraryTag[]>;
	/** Any member. A name that slugs to an existing tag returns that tag. New tags start in "Ungrouped". */
	createTag(actor: Actor, name: string): Promise<LibraryTag>;
	/** Owner or moderator of the item. Replaces the item's tags and refreshes its search text. */
	setItemTags(actor: Actor, itemId: string, tagIds: string[]): Promise<void>;
	renameTag(actor: Actor, tagId: string, name: string): Promise<void>;
	regroupTag(actor: Actor, tagId: string, groupName: string): Promise<void>;
	/** Retags every item carrying `fromId` with `intoId`, then deletes `fromId`. */
	mergeTags(actor: Actor, fromId: string, intoId: string): Promise<void>;
	deleteTag(actor: Actor, tagId: string): Promise<void>;
};

const MAX_NAME_LENGTH = 60;
const DEFAULT_GROUP = "Ungrouped";

// Plain SQL for the same reason as library.ts: drizzle strips table prefixes from columns in a single-table select list.
const itemCountOf = sql<number>`(SELECT COUNT(*) FROM library_item_tags it INNER JOIN library_items i ON i.id = it.item_id WHERE it.tag_id = library_tags.id AND i.status = 'published' AND i.confidentiality <> 'confidential')`.mapWith(Number);

/** Trimmed, inner whitespace collapsed. Case is kept for display; the slug lowercases it. */
function cleanName(name: string): string {
	const clean = name.trim().replace(/\s+/g, " ");
	if (!clean) throw new Error("A tag name is required.");
	if (clean.length > MAX_NAME_LENGTH) throw new Error(`Tag names can be at most ${MAX_NAME_LENGTH} characters.`);
	return clean;
}

const slugOf = (cleanedName: string) => cleanedName.toLowerCase();

function requireModerator(actor: Actor): void {
	if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
}

export function createLibraryTagsRepository(db: Db, audit: AuditRepository): LibraryTagsRepository {
	async function selectTags(where?: SQL): Promise<LibraryTag[]> {
		return db
			.select({ id: libraryTags.id, name: libraryTags.name, groupName: libraryTags.groupName, itemCount: itemCountOf })
			.from(libraryTags)
			.where(where)
			.orderBy(asc(sql`lower(${libraryTags.groupName})`), asc(sql`lower(${libraryTags.name})`), asc(libraryTags.id));
	}

	async function loadTag(id: string) {
		const [row] = await db.select().from(libraryTags).where(eq(libraryTags.id, id)).limit(1);
		if (!row) throw new Error("Tag not found.");
		return row;
	}

	async function itemIdsWith(tagId: string): Promise<string[]> {
		const rows = await db.select({ id: libraryItemTags.itemId }).from(libraryItemTags).where(eq(libraryItemTags.tagId, tagId));
		return rows.map((row) => row.id);
	}

	// ponytail: one refresh (3 queries) per affected item, run in sequence. Fine for a few hundred items per tag;
	// batch the work or queue it if a single tag ever spans thousands.
	async function refreshAll(itemIds: string[]): Promise<void> {
		for (const id of itemIds) await refreshSearchText(db, id);
	}

	async function audited(actor: Actor, action: string, tagId: string, detail: string): Promise<void> {
		await audit.record(actor, { action, targetType: "library_tag", targetId: tagId, category: "library", detail });
	}

	return {
		async listTags() {
			return selectTags();
		},

		async createTag(actor, name) {
			const clean = cleanName(name);
			const slug = slugOf(clean);
			// The unique slug index settles races between two members creating the same tag.
			await db
				.insert(libraryTags)
				.values({ id: createId("ltg"), name: clean, slug, createdBy: actor.memberId })
				.onConflictDoNothing({ target: libraryTags.slug });
			const [tag] = await selectTags(eq(libraryTags.slug, slug));
			return tag;
		},

		async setItemTags(actor, itemId, tagIds) {
			const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
			if (!item || !canEditItem(actor, item)) throw new Error("Library item not found.");
			const unique = [...new Set(tagIds)];
			if (unique.length > 0) {
				const found = await db.select({ id: libraryTags.id }).from(libraryTags).where(inArray(libraryTags.id, unique));
				if (found.length !== unique.length) throw new Error("Unknown tag.");
			}
			const clear = db.delete(libraryItemTags).where(eq(libraryItemTags.itemId, itemId));
			// One batch is one D1 transaction: the item never ends up with no tags because the insert failed.
			if (unique.length === 0) await clear;
			else await db.batch([clear, db.insert(libraryItemTags).values(unique.map((tagId) => ({ itemId, tagId })))]);
			await db.update(libraryItems).set({ updatedAt: new Date() }).where(eq(libraryItems.id, itemId));
			await refreshSearchText(db, itemId);
		},

		async renameTag(actor, tagId, name) {
			requireModerator(actor);
			const tag = await loadTag(tagId);
			const clean = cleanName(name);
			const slug = slugOf(clean);
			if (slug !== tag.slug) {
				const [clash] = await db.select({ id: libraryTags.id }).from(libraryTags).where(eq(libraryTags.slug, slug)).limit(1);
				if (clash) throw new Error("A tag with that name already exists. Merge the two tags instead.");
			}
			await db.update(libraryTags).set({ name: clean, slug }).where(eq(libraryTags.id, tagId));
			await audited(actor, "library:tag_rename", tagId, `${tag.name} -> ${clean}`);
			// Tag names are part of every tagged item's search text.
			await refreshAll(await itemIdsWith(tagId));
		},

		async regroupTag(actor, tagId, groupName) {
			requireModerator(actor);
			const tag = await loadTag(tagId);
			const group = groupName.trim().replace(/\s+/g, " ") || DEFAULT_GROUP;
			if (group.length > MAX_NAME_LENGTH) throw new Error(`Group names can be at most ${MAX_NAME_LENGTH} characters.`);
			await db.update(libraryTags).set({ groupName: group }).where(eq(libraryTags.id, tagId));
			await audited(actor, "library:tag_regroup", tagId, `${tag.name}: ${tag.groupName} -> ${group}`);
		},

		async mergeTags(actor, fromId, intoId) {
			requireModerator(actor);
			if (fromId === intoId) throw new Error("Pick two different tags to merge.");
			const from = await loadTag(fromId);
			const into = await loadTag(intoId);
			const affected = await itemIdsWith(fromId);
			// Insert-from-select (one statement, however many items) skips items that already carry both tags.
			// D1 allows 100 bound parameters per statement, so a values() list would cap a merge at 50 items.
			// All three statements commit together.
			await db.batch([
				db
					.insert(libraryItemTags)
					.select(
						db
							.select({ itemId: libraryItemTags.itemId, tagId: sql<string>`${intoId}`.as("tagId") })
							.from(libraryItemTags)
							.where(eq(libraryItemTags.tagId, fromId)),
					)
					.onConflictDoNothing(),
				db.delete(libraryItemTags).where(eq(libraryItemTags.tagId, fromId)),
				db.delete(libraryTags).where(eq(libraryTags.id, fromId)),
			]);
			await audited(actor, "library:tag_merge", intoId, `${from.name} (${fromId}) -> ${into.name}; items=${affected.length}`);
			await refreshAll(affected);
		},

		async deleteTag(actor, tagId) {
			requireModerator(actor);
			const tag = await loadTag(tagId);
			const affected = await itemIdsWith(tagId);
			await db.batch([db.delete(libraryItemTags).where(eq(libraryItemTags.tagId, tagId)), db.delete(libraryTags).where(eq(libraryTags.id, tagId))]);
			await audited(actor, "library:tag_delete", tagId, `${tag.name}; items=${affected.length}`);
			await refreshAll(affected);
		},
	};
}

export function createUnavailableLibraryTagsRepository(): LibraryTagsRepository {
	const unavailable = () => {
		throw new Error("Library tags are unavailable through this repository adapter.");
	};
	return {
		listTags: unavailable,
		createTag: unavailable,
		setItemTags: unavailable,
		renameTag: unavailable,
		regroupTag: unavailable,
		mergeTags: unavailable,
		deleteTag: unavailable,
	};
}
