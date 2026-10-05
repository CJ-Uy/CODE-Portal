"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { runAction } from "@/lib/email/action-result";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function setOptOutAction(categoryId: string, optedOut: boolean) {
	return runAction(async () => {
		assertFeatureEnabled("email");
		const actor = await requireActor();
		const { email } = await getRepositories();
		await email.member.setOptOut(actor, z.string().min(1).max(64).parse(categoryId), z.boolean().parse(optedOut));
		revalidatePath("/portal/mail/preferences");
		return null;
	});
}
