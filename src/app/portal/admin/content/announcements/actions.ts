"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

const announcementSchema = z.object({
	tag: z.string().trim().min(1).max(24),
	title: z.string().trim().min(1).max(160),
	body: z.string().trim().min(1).max(8000),
	audience: z.string().trim().min(1).max(80),
	pinned: z.coerce.boolean(),
});

function parse(formData: FormData) {
	return announcementSchema.parse({
		tag: formData.get("tag"),
		title: formData.get("title"),
		body: formData.get("body"),
		audience: formData.get("audience"),
		pinned: formData.get("pinned") === "on" || formData.get("pinned") === "true",
	});
}

function revalidate(): void {
	revalidatePath("/portal/admin/content/announcements");
	revalidatePath("/portal/announcements");
}

export async function createAnnouncementAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("announcements");
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.announcements.create(actor, parse(formData));
	revalidate();
}

export async function updateAnnouncementAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("announcements");
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.announcements.update(actor, id, parse(formData));
	revalidate();
}

export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("announcements");
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.announcements.remove(actor, id);
	revalidate();
}
