"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parsePinId, parsePinInput } from "./input";

export async function createNavPinAction(formData: FormData) {
	const actor = await requireActor();
	await (await getRepositories()).navPins.create(actor, parsePinInput(formData));
	revalidatePath("/portal", "layout");
}

export async function updateNavPinAction(formData: FormData) {
	const actor = await requireActor();
	await (await getRepositories()).navPins.update(actor, parsePinId(formData), parsePinInput(formData));
	revalidatePath("/portal", "layout");
}

export async function deleteNavPinAction(formData: FormData) {
	const actor = await requireActor();
	await (await getRepositories()).navPins.remove(actor, parsePinId(formData));
	revalidatePath("/portal", "layout");
}
