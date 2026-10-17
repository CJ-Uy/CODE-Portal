import { and, eq, ne } from "drizzle-orm";
import type { InferSelectModel, SQL } from "drizzle-orm";
import { libraryItems } from "@/db/schema";
import { can } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/permissions";
import type { Db } from "./library";

export type ItemGate = Pick<InferSelectModel<typeof libraryItems>, "status" | "confidentiality" | "createdBy">;

function isOwner(actor: Actor, item: ItemGate): boolean {
	return item.createdBy !== null && item.createdBy === actor.memberId;
}

/** Confidential: managers and the owner. Published: everyone. Anything else: the owner and moderators. */
export function canSeeItem(actor: Actor, item: ItemGate): boolean {
	if (item.confidentiality === "confidential") return can(actor, "library:manage") || isOwner(actor, item);
	if (item.status === "published") return true;
	return isOwner(actor, item) || can(actor, "library:moderate");
}

/** Content edits (title, file, blocks, facets, authors) belong to the owner and to moderators. */
export function canEditItem(actor: Actor, item: ItemGate): boolean {
	return canSeeItem(actor, item) && (isOwner(actor, item) || can(actor, "library:moderate"));
}

/** The upload route's per-item checks: the same rules as the item page. A missing item is never editable or readable. */
export function createLibraryObjectAccess(db: Db) {
	async function loadGate(itemId: string): Promise<ItemGate | null> {
		const [row] = await db
			.select({ status: libraryItems.status, confidentiality: libraryItems.confidentiality, createdBy: libraryItems.createdBy })
			.from(libraryItems)
			.where(eq(libraryItems.id, itemId))
			.limit(1);
		return row ?? null;
	}

	return {
		async canEditLibraryItem(actor: Actor, itemId: string): Promise<boolean> {
			const item = await loadGate(itemId);
			return item !== null && canEditItem(actor, item);
		},
		async canReadLibraryObject(actor: Actor, itemId: string): Promise<boolean> {
			const item = await loadGate(itemId);
			return item !== null && canSeeItem(actor, item);
		},
	};
}

/** Rows a browse or search may return for this actor. Owners find their drafts through listMine instead. */
export function publishedVisibleWhere(actor: Actor): SQL {
	const published = eq(libraryItems.status, "published");
	if (can(actor, "library:manage")) return published;
	return and(published, ne(libraryItems.confidentiality, "confidential")) as SQL;
}
