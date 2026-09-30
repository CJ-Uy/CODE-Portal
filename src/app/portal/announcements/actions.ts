"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function markAnnouncementReadAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("announcements");
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.announcements.markRead(actor, id);
	revalidatePath("/portal/announcements");
}
