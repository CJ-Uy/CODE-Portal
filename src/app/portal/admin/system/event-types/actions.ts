"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parseEventTypeRows, parseEventTypeUpsertInput } from "./input";

export async function upsertEventTypeAction(formData: FormData) {
	const actor = await requireActor();
	const input = parseEventTypeUpsertInput(formData);
	const repositories = await getRepositories();
	await repositories.eventTypeRules.upsertType(actor, input);
	revalidatePath("/portal/admin/system/event-types");
	revalidatePath("/portal/calendar");
}

export async function saveEventTypesAction(formData: FormData) {
	const actor = await requireActor();
	const inputs = parseEventTypeRows(formData);
	const repositories = await getRepositories();
	await Promise.all(inputs.map((input) => repositories.eventTypeRules.upsertType(actor, input)));
	revalidatePath("/portal/admin/system/event-types");
	revalidatePath("/portal/calendar");
}
