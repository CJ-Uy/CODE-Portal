import { z } from "zod";
import type { ImportantLinkInput, LinkCategoryInput, MoveDirection } from "@/db/repositories/important-links";
import { LINK_KINDS } from "@/lib/link-kinds";

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 160;
export const CATEGORY_NAME_MAX = 60;

const idSchema = z.string().trim().min(1).max(64);
const optionalIdSchema = z.union([z.literal(""), idSchema]).transform((value) => value || null);
const blankToNull = (value: string) => value || null;

const linkSchema = z.object({
	title: z.string().trim().min(1, "Give the link a title.").max(TITLE_MAX),
	url: z
		.string()
		.trim()
		.max(2000)
		.url("Enter a full link that starts with https://.")
		.refine((value) => /^https?:\/\//i.test(value), "Links must start with http:// or https://."),
	description: z.string().trim().max(DESCRIPTION_MAX).transform(blankToNull),
	kind: z.union([z.literal(""), z.enum(LINK_KINDS)]).transform((value) => value || null),
	categoryId: optionalIdSchema,
	showInSidebar: z.boolean(),
});

export function parseLinkInput(formData: FormData): ImportantLinkInput {
	return linkSchema.parse({
		title: formData.get("title") ?? "",
		url: formData.get("url") ?? "",
		description: formData.get("description") ?? "",
		kind: formData.get("kind") ?? "",
		categoryId: formData.get("categoryId") ?? "",
		showInSidebar: formData.get("showInSidebar") === "on",
	});
}

export function parseCategoryInput(formData: FormData): LinkCategoryInput {
	return { name: z.string().trim().min(1, "Name the category.").max(CATEGORY_NAME_MAX).parse(formData.get("name") ?? "") };
}

export function parseId(formData: FormData): string {
	return idSchema.parse(formData.get("id"));
}

export function parseMove(formData: FormData): { id: string; direction: MoveDirection } {
	return { id: parseId(formData), direction: z.enum(["up", "down"]).parse(formData.get("direction")) };
}

export function parseArchive(formData: FormData): { id: string; archived: boolean } {
	return { id: parseId(formData), archived: z.enum(["archive", "restore"]).parse(formData.get("intent")) === "archive" };
}
