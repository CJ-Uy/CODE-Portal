"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parsePointTypeRows, parsePointTypeUpsertInput } from "./input";

export async function upsertPointTypeAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.pointTypes.upsertType(actor, parsePointTypeUpsertInput(formData));
	revalidatePath("/portal", "layout");
}

export async function savePointTypesAction(formData: FormData) {
	const actor = await requireActor();
	const inputs = parsePointTypeRows(formData);
	const repositories = await getRepositories();
	for (const input of inputs) {
		await repositories.pointTypes.upsertType(actor, input);
	}
	revalidatePath("/portal", "layout");
}
