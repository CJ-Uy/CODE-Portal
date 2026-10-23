"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import type { Repositories } from "@/db/repositories";
import { requireActor } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { parseArchive, parseCategoryInput, parseId, parseLinkInput, parseMove } from "./input";

// The repository checks nav:configure and writes the audit log; every change refreshes the editor,
// the member directory and the sidebar pins that the portal layout renders.
async function run(change: (repositories: Repositories, actor: Actor) => Promise<unknown>) {
	const actor = await requireActor();
	await change(await getRepositories(), actor);
	revalidatePath("/portal", "layout");
}

export async function createLinkAction(formData: FormData) {
	const input = parseLinkInput(formData);
	await run((repositories, actor) => repositories.importantLinks.createLink(actor, input));
}

export async function updateLinkAction(formData: FormData) {
	const id = parseId(formData);
	const input = parseLinkInput(formData);
	await run((repositories, actor) => repositories.importantLinks.updateLink(actor, id, input));
}

export async function archiveLinkAction(formData: FormData) {
	const { id, archived } = parseArchive(formData);
	await run((repositories, actor) => repositories.importantLinks.setLinkArchived(actor, id, archived));
}

export async function moveLinkAction(formData: FormData) {
	const { id, direction } = parseMove(formData);
	await run((repositories, actor) => repositories.importantLinks.moveLink(actor, id, direction));
}

export async function createCategoryAction(formData: FormData) {
	const input = parseCategoryInput(formData);
	await run((repositories, actor) => repositories.importantLinks.createCategory(actor, input));
}

export async function renameCategoryAction(formData: FormData) {
	const id = parseId(formData);
	const input = parseCategoryInput(formData);
	await run((repositories, actor) => repositories.importantLinks.updateCategory(actor, id, input));
}

export async function archiveCategoryAction(formData: FormData) {
	const { id, archived } = parseArchive(formData);
	await run((repositories, actor) => repositories.importantLinks.setCategoryArchived(actor, id, archived));
}

export async function moveCategoryAction(formData: FormData) {
	const { id, direction } = parseMove(formData);
	await run((repositories, actor) => repositories.importantLinks.moveCategory(actor, id, direction));
}
