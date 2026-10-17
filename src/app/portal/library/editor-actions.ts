"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { getRepositories } from "@/db";
import type { LibraryStatus } from "@/lib/library/taxonomy";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import {
	attachFileInputSchema,
	createDraftInputSchema,
	draftProblem,
	editProblems,
	isOwnFileKey,
	itemIdInputSchema,
	publishInputSchema,
	publishProblems,
	saveItemInputSchema,
	tagNameSchema,
	type SaveItemInput,
} from "./editor-input";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check what you entered and try again.";

/** The repository's own messages are written for members; anything that looks like a database error is not shown. */
function friendly(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	return message && message.length < 200 && !/D1_|SQLITE|SQL|constraint/i.test(message) ? message : "Could not save. Try again.";
}

async function guard() {
	assertFeatureEnabled("library");
	return { actor: await requireActor(), repositories: await getRepositories() };
}

function revalidateItem(itemId: string) {
	revalidatePath(`/portal/library/${itemId}`);
	revalidatePath(`/portal/library/${itemId}/edit`);
	revalidatePath("/portal/library/mine");
	revalidatePath("/portal/library");
}

/** The three choices on /new. Starts a draft the actor owns, credits them as the author, and opens the editor. */
export async function createDraftAction(formData: FormData): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = createDraftInputSchema.safeParse(Object.fromEntries(formData));
	if (!parsed.success) {
		// Back to the form with a fixed code (not the message), saying which card it was and keeping the list.
		const back = new URLSearchParams({ problem: draftProblem(parsed.error) });
		const card = formData.get("format");
		if (card === "file" || card === "page" || card === "link") back.set("for", card);
		const list = formData.get("listId");
		if (typeof list === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(list)) back.set("list", list);
		redirect(`/portal/library/new?${back}`);
	}
	const { kind, format, title, listId } = parsed.data;

	// Anyone may read their own name; the name is only a default and the author can change it.
	const me = await repositories.members.getById(actor, actor.memberId).catch(() => null);
	const name = (me?.fullName || me?.name || "").trim();
	const item = await repositories.library.createDraft(actor, {
		kind,
		format,
		title,
		authors: name ? [{ name, memberId: actor.memberId }] : [],
	});

	if (listId) {
		// A list the actor cannot edit is not an error: the draft is theirs either way.
		await repositories.libraryLists.addItem(actor, { listId, itemId: item.id }).catch(() => undefined);
		revalidatePath(`/portal/library/lists/${listId}`);
		revalidatePath("/portal/library/lists");
	}
	revalidatePath("/portal/library/mine");
	redirect(`/portal/library/${item.id}/edit`);
}

/** Autosave target. Only the fields that changed arrive; tags go through their own batch so a bad tag never half-saves the item. */
export async function saveItemAction(input: SaveItemInput): Promise<Result> {
	const { actor, repositories } = await guard();
	const parsed = saveItemInputSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
	const { itemId, tagIds, ...fields } = parsed.data;
	try {
		// Past draft an item has readers: never save it into a state publishing would have refused (no link, empty page).
		if (fields.title !== undefined || fields.url !== undefined || fields.blocks !== undefined) {
			const current = await repositories.library.getItem(actor, itemId);
			if (!current?.canEdit) return { ok: false, error: "Library item not found." };
			const [problem] = editProblems(
				{ status: current.status, format: current.format, title: current.title, fileKey: current.fileKey, url: current.url, blocks: current.blocksJson },
				fields,
			);
			if (problem) return { ok: false, error: problem };
		}
		if (Object.keys(fields).length > 0) await repositories.library.updateItem(actor, itemId, fields);
		if (tagIds) await repositories.libraryTags.setItemTags(actor, itemId, tagIds);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: friendly(error) };
	}
}

/** Links an upload to its item. The key must be the one the upload route just handed this actor for this item. */
export async function attachFileAction(input: { itemId: string; key: string; name: string; type: string; bytes: number }): Promise<void> {
	const { actor, repositories } = await guard();
	const parsed = attachFileInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const { itemId, key, name, type, bytes } = parsed.data;
	if (!isOwnFileKey(key, itemId, actor.memberId)) throw new Error("That file does not belong to this item.");
	const item = await repositories.library.getItem(actor, itemId);
	if (!item?.canEdit) throw new Error("Library item not found.");
	if (item.format !== "file") throw new Error("This item is not a file.");
	await repositories.library.setFile(actor, itemId, { key, name, type, bytes });
	revalidateItem(itemId);
}

/** The owner's publish. Goes live, or to a moderator when the item includes client data. */
export async function publishAction(input: { itemId: string; containsClientData: boolean }): Promise<{ status: LibraryStatus }> {
	const { actor, repositories } = await guard();
	const parsed = publishInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const { itemId, containsClientData } = parsed.data;
	const item = await repositories.library.getItem(actor, itemId);
	if (!item?.canEdit) throw new Error("Library item not found.");
	const [problem] = publishProblems({ format: item.format, title: item.title, fileKey: item.fileKey, url: item.url, blocks: item.blocksJson });
	if (problem) throw new Error(problem);
	const status = await repositories.library.publish(actor, itemId, { containsClientData });
	revalidateItem(itemId);
	return { status };
}

/** "This now includes client names or client data": a published item goes back to a moderator and is hidden until approved. */
export async function flagClientDataAction(input: { itemId: string }): Promise<{ status: LibraryStatus }> {
	const { actor, repositories } = await guard();
	const parsed = itemIdInputSchema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	const status = await repositories.library.flagClientData(actor, parsed.data.itemId);
	revalidateItem(parsed.data.itemId);
	return { status };
}

/** A new tag is live at once; a name that matches an existing tag returns that tag. */
export async function createTagAction(name: string): Promise<Result<{ tag: { id: string; name: string; groupName: string } }>> {
	const { actor, repositories } = await guard();
	const parsed = tagNameSchema.safeParse(name);
	if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
	try {
		const tag = await repositories.libraryTags.createTag(actor, parsed.data);
		return { ok: true, tag: { id: tag.id, name: tag.name, groupName: tag.groupName } };
	} catch (error) {
		return { ok: false, error: friendly(error) };
	}
}

/** Names only (no emails), for linking a co-author to their member profile. */
export async function searchAuthorsAction(query: string): Promise<{ id: string; name: string }[]> {
	const { actor, repositories } = await guard();
	if (typeof query !== "string") return [];
	return repositories.library.searchMembers(actor, query.slice(0, 60)).catch(() => []);
}
