"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { toCardFields, type LibraryCardFields } from "@/lib/library/card-fields";
import { effectiveSort, parseLibrarySearchParams, rawParams } from "@/lib/library/search-params";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

/**
 * The next rows of the library list: the page's own search (its query string), read on from the cursor the last load
 * ended with. Plain search only; a smart list arrives whole and never asks for more. Visibility is the repository's.
 */
export async function loadMoreLibraryAction(query: string, cursor: string): Promise<{ cards: LibraryCardFields[]; nextCursor: string | null }> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const search = parseLibrarySearchParams(rawParams(z.string().max(4000).parse(query)));
	const repositories = await getRepositories();
	const page = await repositories.library.search(actor, { ...search, sort: effectiveSort(search), cursor: z.string().min(1).max(2000).parse(cursor) });
	return { cards: page.cards.map(toCardFields), nextCursor: page.nextCursor };
}

export async function addCommentAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));
	const parentId = (formData.get("parentId") as string | null)?.trim() || null;
	const anonymous = formData.get("anonymous") === "on" || formData.get("anonymous") === "true";
	const repositories = await getRepositories();
	await repositories.library.addComment(actor, { itemId, parentId, anonymous, body });
	revalidatePath(`/portal/library/${itemId}`);
}

export async function setCommentHiddenAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const commentId = z.string().min(1).parse(formData.get("commentId"));
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const hidden = formData.get("hidden") === "true";
	const repositories = await getRepositories();
	await repositories.library.setCommentHidden(actor, commentId, hidden);
	revalidatePath(`/portal/library/${itemId}`);
}

/** The member's "Smart search" switch in the library filters. Remembered on their member row; ?smart=1|0 still wins per request. */
export async function setSmartSearchAction(on: boolean): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const librarySmartSearch = z.boolean().parse(on);
	const repositories = await getRepositories();
	await repositories.members.updateProfile(actor, actor.memberId, { librarySmartSearch });
	revalidatePath("/portal/library", "layout");
}

export async function requestAccessAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const repositories = await getRepositories();
	await repositories.library.requestAccess(actor, itemId);
	revalidatePath("/portal/library");
}
