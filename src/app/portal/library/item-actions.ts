"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import { scheduleLibraryIndex } from "@/server/library/indexer";
import { getStorageAdapter } from "@/storage";
import {
	confidentialityInputSchema,
	deleteInputSchema,
	keysUnderItem,
	moderateInputSchema,
	publicReadinessInputSchema,
	reportInputSchema,
	saveToNewListInputSchema,
	toggleSaveInputSchema,
} from "./item-input";

// These throw on failure (the client shows the message through actionErrorMessage); a rejected input names its first problem.
const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check what you entered and try again.";

async function guard() {
	assertFeatureEnabled("library");
	return { actor: await requireActor(), repositories: await getRepositories() };
}

function revalidateItem(itemId: string) {
	revalidatePath(`/portal/library/${itemId}`);
	revalidatePath("/portal/library");
	revalidatePath("/portal/library/lists");
	revalidatePath("/portal/library/mine");
}

/** Puts the item in a list (`saved: true`) or takes it out (`saved: false`). `"saved"` is the member's default list. */
export async function toggleSaveAction(input: { itemId: string; listId: string | "saved"; saved: boolean }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = toggleSaveInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const { itemId, saved } = parsed.data;
	const listId = parsed.data.listId === "saved" ? await repositories.libraryLists.ensureSaved(actor) : parsed.data.listId;
	if (saved) await repositories.libraryLists.addItem(actor, { listId, itemId });
	else await repositories.libraryLists.removeItem(actor, { listId, itemId });
	revalidateItem(itemId);
}

/** The picker's "New list": creates it and puts the item in. */
export async function saveToNewListAction(input: { itemId: string; name: string }): Promise<{ listId: string }> {
	const { actor, repositories } = await guard();
	const parsed = saveToNewListInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	// Nothing is created for an item the member cannot see.
	if (!(await repositories.library.getItem(actor, parsed.data.itemId))) throw new Error("Library item not found.");
	const listId = await repositories.libraryLists.createList(actor, { name: parsed.data.name });
	await repositories.libraryLists.addItem(actor, { listId, itemId: parsed.data.itemId });
	revalidateItem(parsed.data.itemId);
	return { listId };
}

/** An item, or a shared list, for a moderator to look at. A repeat while the member's report is open does nothing. */
export async function reportAction(input: { itemId?: string; listId?: string; reason: string; details?: string }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = reportInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	await repositories.library.report(actor, parsed.data);
}

export async function moderateItemAction(input: { itemId: string; action: "approve" | "send_back" | "take_down" | "restore"; reason?: string }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = moderateInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const { itemId, action } = parsed.data;
	await repositories.library.moderate(actor, itemId, action, parsed.data.reason);
	if (action === "approve" || action === "restore") scheduleLibraryIndex(itemId, "index");
	if (action === "take_down") scheduleLibraryIndex(itemId, "deindex");
	revalidateItem(itemId);
	revalidatePath("/portal/admin/content/library");
}

/** library:moderate. `null` clears the label (not reviewed yet). */
export async function setPublicReadinessAction(input: { itemId: string; value: "not_eligible" | "needs_adapting" | "public_ready" | null }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = publicReadinessInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	await repositories.library.setPublicReadiness(actor, parsed.data.itemId, parsed.data.value);
	revalidateItem(parsed.data.itemId);
}

/** library:manage. */
export async function setConfidentialityAction(input: { itemId: string; value: "members" | "confidential" }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = confidentialityInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	await repositories.library.setConfidentiality(actor, parsed.data.itemId, parsed.data.value);
	// Confidential items never sit in the vector index; back to members, the item is embedded again.
	scheduleLibraryIndex(parsed.data.itemId, parsed.data.value === "confidential" ? "deindex" : "index");
	revalidateItem(parsed.data.itemId);
}

/**
 * library:manage, behind a typed title. The item and its rows go first; then its storage objects, and only those under
 * `library/<itemId>/` (the repository hands back every key the item points at, which may include another item's file).
 * A storage failure leaves an orphaned object, never a half-deleted item, so it is logged and not raised.
 */
export async function deleteItemAction(input: { itemId: string; confirmTitle: string }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = deleteInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const { itemId, confirmTitle } = parsed.data;
	const item = await repositories.library.getItem(actor, itemId);
	if (!item) throw new Error("Library item not found.");
	if (confirmTitle.trim() !== item.title.trim()) throw new Error("Type the title exactly to delete this item.");

	const { fileKeys } = await repositories.library.deleteItem(actor, itemId);
	scheduleLibraryIndex(itemId, "deindex");
	const keys = keysUnderItem(itemId, fileKeys);
	if (keys.length > 0) {
		const storage = await getStorageAdapter();
		const results = await Promise.allSettled(keys.map((key) => storage.deleteObject(key)));
		// Fixed text on purpose: the error or the keys could name a member.
		if (results.some((result) => result.status === "rejected")) console.error("Some library files could not be deleted from storage.");
	}
	revalidateItem(itemId);
	revalidatePath("/portal/admin/content/library");
	redirect("/portal/library");
}
