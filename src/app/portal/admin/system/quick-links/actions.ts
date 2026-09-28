"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

const linkSchema = z.object({
	label: z.string().trim().min(1).max(80),
	url: z.string().trim().url().refine((value) => /^https?:\/\//.test(value), "URL must be http or https."),
	position: z.coerce.number().int().min(0).max(999),
});

function parseLink(formData: FormData) {
	return linkSchema.parse({
		label: formData.get("label"),
		url: formData.get("url"),
		position: formData.get("position"),
	});
}

export async function createQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.quickLinks.create(actor, parseLink(formData));
	revalidatePath("/portal/admin/system/quick-links");
	revalidatePath("/portal/admin");
}

export async function updateQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.quickLinks.update(actor, id, parseLink(formData));
	revalidatePath("/portal/admin/system/quick-links");
	revalidatePath("/portal/admin");
}

export async function deleteQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.quickLinks.remove(actor, id);
	revalidatePath("/portal/admin/system/quick-links");
	revalidatePath("/portal/admin");
}
