"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { parseEmailColumn } from "@/lib/roster-emails";
import { requireActor } from "@/server/auth/actor";

const inviteSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
});

export async function inviteMemberAction(formData: FormData) {
	const actor = await requireActor();
	const input = inviteSchema.parse({ email: formData.get("email") });
	const repositories = await getRepositories();
	await repositories.members.create(actor, { email: input.email, name: null });
	revalidatePath("/portal/admin/members/list");
	revalidatePath("/portal/admin/members/roles");
}

export type BulkAddResult = { processed: number; dedupedInput: number; invalid: string[] };

export async function bulkAddMembersAction(input: { raw: string }): Promise<BulkAddResult> {
	const actor = await requireActor();
	const raw = z.string().max(64 * 1024, "Too much text pasted — split into smaller batches.").parse(input.raw);
	const { valid, invalid, dedupedInput } = parseEmailColumn(raw);
	if (valid.length > 500) {
		throw new Error("Too many emails (max 500 per submission). Split into smaller batches.");
	}
	const repositories = await getRepositories();
	for (const email of valid) {
		await repositories.members.create(actor, { email, name: null });
	}
	revalidatePath("/portal/admin/members/list");
	revalidatePath("/portal/admin/members/roles");
	return { processed: valid.length, dedupedInput, invalid };
}

export async function deleteMemberAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.members.delete(actor, id);
	revalidatePath("/portal/admin/members/list");
	revalidatePath("/portal/admin/members/roles");
}
