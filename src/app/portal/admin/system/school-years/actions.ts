"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parseTermUpsertInput } from "./input";

export type TermFormState = { error: string } | null;

export async function upsertTermAction(_state: TermFormState, formData: FormData): Promise<TermFormState> {
	const actor = await requireActor();
	const repositories = await getRepositories();
	try {
		await repositories.retention.upsertTerm(actor, parseTermUpsertInput(formData));
	} catch (error) {
		// Zod stringifies its issues as JSON, which is unreadable in a form; the repository
		// throws the messages that are actually worth showing.
		if (error instanceof z.ZodError) return { error: "Check the name, dates, and thresholds." };
		return { error: error instanceof Error ? error.message : "Could not save this school year." };
	}
	revalidatePath("/portal", "layout");
	return null;
}
