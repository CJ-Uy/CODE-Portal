"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { navPinIconNames } from "@/components/portal/nav-pin-icons";
import { requireActor } from "@/server/auth/actor";

const pinSchema = z.object({
	label: z.string().trim().min(1).max(80),
	url: z.string().trim().url().refine((value) => /^https?:\/\//.test(value), "URL must be http or https."),
	icon: z.enum(navPinIconNames),
	position: z.coerce.number().int().min(0).max(999),
});

function parsePin(formData: FormData) {
	return pinSchema.parse({
		label: formData.get("label"),
		url: formData.get("url"),
		icon: formData.get("icon"),
		position: formData.get("position"),
	});
}

export async function createNavPinAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.navPins.create(actor, parsePin(formData));
	revalidatePath("/portal/admin/system/nav-pins");
	revalidatePath("/portal");
}

export async function updateNavPinAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.navPins.update(actor, id, parsePin(formData));
	revalidatePath("/portal/admin/system/nav-pins");
	revalidatePath("/portal");
}

export async function saveNavPinsAction(formData: FormData) {
	const actor = await requireActor();
	const ids = z.array(z.string().min(1)).parse(formData.getAll("ids"));
	const labels = formData.getAll("labels");
	const urls = formData.getAll("urls");
	const icons = formData.getAll("icons");
	if (ids.length !== labels.length || ids.length !== urls.length || ids.length !== icons.length) {
		throw new Error("Nav pin form is incomplete.");
	}
	const repositories = await getRepositories();
	await Promise.all(
		ids.map((id, position) =>
			repositories.navPins.update(
				actor,
				id,
				pinSchema.parse({
					label: labels[position],
					url: urls[position],
					icon: icons[position],
					position,
				}),
			),
		),
	);
	revalidatePath("/portal/admin/system/nav-pins");
	revalidatePath("/portal");
}

export async function deleteNavPinAction(id: string) {
	const actor = await requireActor();
	const pinId = z.string().min(1).parse(id);
	const repositories = await getRepositories();
	await repositories.navPins.remove(actor, pinId);
	revalidatePath("/portal/admin/system/nav-pins");
	revalidatePath("/portal");
}
