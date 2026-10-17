"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError, ZodType } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import {
	addListCommentInputSchema,
	createListInputSchema,
	editorInputSchema,
	listIdInputSchema,
	listItemInputSchema,
	reorderInputSchema,
	setCommentHiddenInputSchema,
	setNoteInputSchema,
	setPinnedInputSchema,
	setSharedInputSchema,
	takeDownInputSchema,
	updateListInputSchema,
} from "./list-input";

// Where a moderator who is not a member of a list lands after restoring it. The moderation page (/portal/admin/content/library) is
// still a stub with nowhere to show a confirmation, and nothing above the library pages shows toasts, so the lists page carries a fixed-code notice.
// ponytail: point this at the moderation queue (with its own flash) once Task 16 builds it.
const AFTER_RESTORE = "/portal/library/lists?notice=restored";

// These throw on failure (the client shows the message through actionErrorMessage); a rejected input names its first problem.
const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check what you entered and try again.";

/** Feature flag, signed-in actor, repositories, and the input checked: nothing reaches a repository unchecked. */
async function guard<T>(schema: ZodType<T>, input: unknown) {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	return { actor, repositories: await getRepositories(), input: parsed.data };
}

function revalidateList(listId: string) {
	revalidatePath("/portal/library/lists");
	revalidatePath(`/portal/library/lists/${listId}`);
}

export async function createListAction(input: { name: string; description?: string }): Promise<{ listId: string }> {
	const { actor, repositories, input: data } = await guard(createListInputSchema, input);
	const listId = await repositories.libraryLists.createList(actor, data);
	revalidateList(listId);
	return { listId };
}

/** Owner. Only the fields that are sent change. */
export async function updateListAction(input: { listId: string; name?: string; description?: string; color?: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(updateListInputSchema, input);
	const { listId, ...changes } = data;
	await repositories.libraryLists.updateList(actor, listId, changes);
	revalidateList(listId);
}

/** Owner. Never the Saved list. */
export async function deleteListAction(input: { listId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(listIdInputSchema, input);
	await repositories.libraryLists.deleteList(actor, data.listId);
	revalidateList(data.listId);
	redirect("/portal/library/lists");
}

/** Owner. Refused while a moderator has the list taken down. */
export async function setSharedAction(input: { listId: string; shared: boolean }): Promise<void> {
	const { actor, repositories, input: data } = await guard(setSharedInputSchema, input);
	await repositories.libraryLists.setShared(actor, data.listId, data.shared);
	revalidateList(data.listId);
}

export async function addEditorAction(input: { listId: string; memberId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(editorInputSchema, input);
	await repositories.libraryLists.addEditor(actor, data.listId, data.memberId);
	revalidateList(data.listId);
}

/** The owner removing anyone, or an editor leaving: the one who just left has nothing to look at, so they go back to the lists. */
export async function removeEditorAction(input: { listId: string; memberId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(editorInputSchema, input);
	await repositories.libraryLists.removeEditor(actor, data.listId, data.memberId);
	revalidateList(data.listId);
	if (data.memberId === actor.memberId) redirect("/portal/library/lists");
}

export async function removeListItemAction(input: { listId: string; itemId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(listItemInputSchema, input);
	await repositories.libraryLists.removeItem(actor, data);
	revalidateList(data.listId);
	// The item page shows which lists hold it.
	revalidatePath(`/portal/library/${data.itemId}`);
}

/** An empty note clears it. */
export async function setNoteAction(input: { listId: string; itemId: string; note: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(setNoteInputSchema, input);
	await repositories.libraryLists.setNote(actor, data);
	revalidateList(data.listId);
}

/** `itemIds` is the whole new order. */
export async function reorderAction(input: { listId: string; itemIds: string[] }): Promise<void> {
	const { actor, repositories, input: data } = await guard(reorderInputSchema, input);
	await repositories.libraryLists.reorder(actor, data.listId, data.itemIds);
	revalidateList(data.listId);
}

export async function addListCommentAction(input: { listId: string; parentId?: string | null; anonymous: boolean; body: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(addListCommentInputSchema, input);
	await repositories.libraryLists.addComment(actor, data);
	revalidateList(data.listId);
}

/** library:moderate. The comment must belong to this list: the page to refresh comes from the request, so it is checked before anything is written. */
export async function setListCommentHiddenAction(input: { listId: string; commentId: string; hidden: boolean }): Promise<void> {
	const { actor, repositories, input: data } = await guard(setCommentHiddenInputSchema, input);
	const thread = await repositories.libraryLists.listComments(actor, data.listId);
	if (!thread.some((comment) => comment.id === data.commentId)) throw new Error("Comment not found.");
	await repositories.libraryLists.setCommentHidden(actor, data.commentId, data.hidden);
	revalidateList(data.listId);
}

/** library:moderate. Only a shared list can be pinned. */
export async function setPinnedAction(input: { listId: string; pinned: boolean; pinOrder?: number }): Promise<void> {
	const { actor, repositories, input: data } = await guard(setPinnedInputSchema, input);
	await repositories.libraryLists.setPinned(actor, data.listId, data.pinned, data.pinOrder);
	revalidateList(data.listId);
}

/** library:moderate. The owner and editors see the reason. */
export async function takeDownListAction(input: { listId: string; reason: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(takeDownInputSchema, input);
	await repositories.libraryLists.takeDown(actor, data.listId, data.reason);
	revalidateList(data.listId);
}

/**
 * library:moderate. The list stays unshared (its owner chooses whether to share it again), so a moderator who is neither its
 * owner nor an editor can no longer open it unless a report is still open: they are sent away with a notice instead of a 404.
 * The role is read before the restore, while the list is still readable to them.
 */
export async function restoreListAction(input: { listId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(listIdInputSchema, input);
	const before = await repositories.libraryLists.getList(actor, data.listId);
	await repositories.libraryLists.restore(actor, data.listId);
	revalidateList(data.listId);
	if (before?.role === "viewer") redirect(AFTER_RESTORE);
}
