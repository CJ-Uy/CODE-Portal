"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

const idSchema = z.string().trim().min(1).max(64);

export async function markNotificationReadAction(id: string): Promise<void> {
	assertFeatureEnabled("notifications");
	const notificationId = idSchema.parse(id);
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.notifications.markRead(actor, notificationId);
	revalidatePath("/portal/notifications");
	revalidatePath("/portal");
}

export async function markAllNotificationsReadAction(): Promise<void> {
	assertFeatureEnabled("notifications");
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.notifications.markAllRead(actor);
	revalidatePath("/portal/notifications");
	revalidatePath("/portal");
}
