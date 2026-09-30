"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function toggleFavoriteAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const repositories = await getRepositories();
	await repositories.library.toggleFavorite(actor, itemId);
	revalidatePath(`/portal/library/${itemId}`);
	revalidatePath("/portal/library/lists");
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

export async function requestAccessAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const repositories = await getRepositories();
	await repositories.library.requestAccess(actor, itemId);
	revalidatePath("/portal/library");
}

export async function createListAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const name = z.string().trim().min(1).max(60).parse(formData.get("name"));
	const color = z.string().trim().min(1).max(20).parse(formData.get("color") || "#0c315c");
	const repositories = await getRepositories();
	await repositories.library.createList(actor, { name, color });
	revalidatePath("/portal/library/lists");
}

export async function addToListAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const listId = z.string().min(1).parse(formData.get("listId"));
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const repositories = await getRepositories();
	await repositories.library.addToList(actor, { listId, itemId });
	revalidatePath("/portal/library/lists");
}

export async function removeFromListAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const listId = z.string().min(1).parse(formData.get("listId"));
	const itemId = z.string().min(1).parse(formData.get("itemId"));
	const repositories = await getRepositories();
	await repositories.library.removeFromList(actor, { listId, itemId });
	revalidatePath("/portal/library/lists");
}
