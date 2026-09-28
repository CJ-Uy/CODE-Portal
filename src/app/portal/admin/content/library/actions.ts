"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";
import type { LibraryItemInput } from "@/db/repositories/library";

const scalarSchema = z.object({
	kind: z.enum(["article", "case_study"]),
	confidentiality: z.enum(["public", "members", "confidential"]),
	category: z.string().trim().min(1).max(60),
	title: z.string().trim().min(1).max(200),
	dek: z.string().trim().max(400),
	readMinutes: z.coerce.number().int().min(1).max(180),
	abstract: z.string().trim().max(8000),
});

function lines(value: FormDataEntryValue | null): string[] {
	return String(value ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseItem(formData: FormData): LibraryItemInput {
	const scalar = scalarSchema.parse({
		kind: formData.get("kind"),
		confidentiality: formData.get("confidentiality"),
		category: formData.get("category"),
		title: formData.get("title"),
		dek: formData.get("dek"),
		readMinutes: formData.get("readMinutes"),
		abstract: formData.get("abstract"),
	});
	// Structured fields use a "|"-separated, one-per-line convention.
	const sections = lines(formData.get("sections")).map((line) => {
		const [heading, ...rest] = line.split("|");
		return { heading: heading.trim(), body: rest.join("|").trim() };
	});
	const components = lines(formData.get("components")).map((line) => {
		const [name, definition, example] = line.split("|");
		return { name: (name ?? "").trim(), definition: (definition ?? "").trim(), example: (example ?? "").trim() };
	});
	return {
		...scalar,
		sections,
		components,
		questions: lines(formData.get("questions")),
		references: lines(formData.get("references")),
		topics: lines(formData.get("topics")),
	};
}

function revalidate(id?: string): void {
	revalidatePath("/portal/admin/content/library");
	revalidatePath("/portal/library");
	if (id) revalidatePath(`/portal/library/${id}`);
}

export async function createLibraryItemAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.library.createItem(actor, parseItem(formData));
	revalidate();
}

export async function updateLibraryItemAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.library.updateItem(actor, id, parseItem(formData));
	revalidate(id);
}

export async function deleteLibraryItemAction(formData: FormData): Promise<void> {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.library.removeItem(actor, id);
	revalidate(id);
}
