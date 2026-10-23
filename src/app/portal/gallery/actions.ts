"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import type { Repositories } from "@/db/repositories";
import type { Actor } from "@/server/auth/permissions";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import { GALLERY_BATCH } from "@/lib/gallery/view";

export type GalleryActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

const id = z.string().min(1).max(64);
// One update and one audit row per item; the client sends larger selections in chunks of this size.
const ids = z.array(id).min(1).max(GALLERY_BATCH);
const folderRef = id.nullable();

/**
 * Next hides thrown messages in production, so these return the repository's own words ("You can only
 * restore what you deleted.") for the client to show. Permissions are the repository's job, not this file's.
 */
async function run<T>(work: (actor: Actor, repositories: Repositories) => Promise<T>): Promise<GalleryActionResult<T>> {
	try {
		assertFeatureEnabled("gallery");
		const value = await work(await requireActor(), await getRepositories());
		revalidatePath("/portal/gallery", "layout");
		revalidatePath("/gallery", "layout");
		return { ok: true, value };
	} catch (error) {
		if (error instanceof z.ZodError) return { ok: false, error: "Check what you entered and try again." };
		return { ok: false, error: error instanceof Error && error.message.length < 200 ? error.message : "Something went wrong. Try again." };
	}
}

export async function createFolderAction(input: { name: string; parentId: string | null }) {
	return run((actor, { gallery }) => gallery.createFolder(actor, z.object({ name: z.string().max(200), parentId: folderRef }).parse(input)));
}

export async function updateFolderAction(input: { folderId: string; name?: string; eventId?: string | null; isPublic?: boolean }) {
	return run((actor, { gallery }) => {
		const parsed = z.object({ folderId: id, name: z.string().max(200).optional(), eventId: folderRef.optional(), isPublic: z.boolean().optional() }).parse(input);
		return gallery.updateFolder(actor, parsed.folderId, { name: parsed.name, eventId: parsed.eventId, isPublic: parsed.isPublic });
	});
}

export async function moveFolderAction(input: { folderId: string; parentId: string | null }) {
	return run((actor, { gallery }) => {
		const parsed = z.object({ folderId: id, parentId: folderRef }).parse(input);
		return gallery.moveFolder(actor, parsed.folderId, parsed.parentId);
	});
}

export async function deleteFolderAction(input: { folderId: string }) {
	return run((actor, { gallery }) => gallery.deleteFolder(actor, z.object({ folderId: id }).parse(input).folderId));
}

export async function updateItemAction(input: { itemId: string; caption?: string | null; takenAt?: string | null; eventId?: string | null }) {
	return run((actor, { gallery }) => {
		const parsed = z
			.object({ itemId: id, caption: z.string().max(4000).nullable().optional(), takenAt: z.string().datetime({ offset: true }).nullable().optional(), eventId: folderRef.optional() })
			.parse(input);
		const patch: Parameters<Repositories["gallery"]["updateItem"]>[2] = {};
		if (parsed.caption !== undefined) patch.caption = parsed.caption;
		if (parsed.takenAt !== undefined) patch.takenAt = parsed.takenAt ? new Date(parsed.takenAt) : null;
		if (parsed.eventId !== undefined) patch.eventId = parsed.eventId;
		return gallery.updateItem(actor, parsed.itemId, patch);
	});
}

export async function moveItemsAction(input: { itemIds: string[]; folderId: string | null }) {
	return run((actor, { gallery }) => {
		const parsed = z.object({ itemIds: ids, folderId: folderRef }).parse(input);
		return gallery.moveItems(actor, parsed.itemIds, parsed.folderId);
	});
}

export async function deleteItemsAction(input: { itemIds: string[] }) {
	return run((actor, { gallery }) => gallery.deleteItems(actor, z.object({ itemIds: ids }).parse(input).itemIds));
}

export async function restoreAction(input: { itemIds: string[]; folderIds: string[] }) {
	return run((actor, { gallery }) => gallery.restore(actor, z.object({ itemIds: z.array(id).max(GALLERY_BATCH), folderIds: z.array(id).max(GALLERY_BATCH) }).parse(input)));
}

export async function setHeartAction(input: { itemId: string; on: boolean }) {
	return run((actor, { gallery }) => {
		const parsed = z.object({ itemId: id, on: z.boolean() }).parse(input);
		return gallery.setHeart(actor, parsed.itemId, parsed.on);
	});
}

export async function addTagAction(input: { itemId: string; memberId?: string; label?: string }) {
	return run((actor, { gallery }) => {
		const parsed = z.object({ itemId: id, memberId: id.optional(), label: z.string().max(200).optional() }).parse(input);
		return gallery.addTag(actor, parsed.itemId, parsed.memberId ? { memberId: parsed.memberId } : { label: parsed.label ?? "" });
	});
}

export async function removeTagAction(input: { tagId: string }) {
	return run((actor, { gallery }) => gallery.removeTag(actor, z.object({ tagId: id }).parse(input).tagId));
}

/** A lightbox open. Fire and forget: no refresh, no message, and a failure costs one view. */
export async function recordViewAction(itemId: string): Promise<void> {
	try {
		assertFeatureEnabled("gallery");
		const { gallery } = await getRepositories();
		await gallery.recordView(await requireActor(), id.parse(itemId));
	} catch {
		// A lost view is not worth surfacing.
	}
}
