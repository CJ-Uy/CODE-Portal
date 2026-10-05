"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getRepositories } from "@/db";
import { mentsContract } from "@/db/contract/ments";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function reportPmentsAction(personIds: string[]): Promise<{ error?: string }> {
	try {
		assertFeatureEnabled("ments");
		const actor = await requireActor();
		const { ments } = await getRepositories();
		await ments.reportPments(actor, mentsContract.reportPments.input.parse({ personIds }).personIds);
		revalidatePath("/portal/ments");
		revalidatePath("/portal/admin/members/ments");
		return {};
	} catch (error) {
		return { error: error instanceof ZodError ? error.issues[0]?.message : error instanceof Error && !error.cause ? error.message : "Could not save your Pments. Try again." };
	}
}
