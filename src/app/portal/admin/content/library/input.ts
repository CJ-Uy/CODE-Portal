import { z } from "zod";
import { itemIdInputSchema } from "@/app/portal/library/editor-input";
import { listIdInputSchema, REASON_MAX } from "@/app/portal/library/list-input";

/** Everything the moderation page takes from the browser (the URL and the server actions) is checked here first. */

export const TABS = [
	{ key: "waiting", label: "Waiting for approval" },
	{ key: "reports", label: "Reports" },
	{ key: "taken-down", label: "Taken down" },
	{ key: "tags", label: "Tags" },
	{ key: "search-index", label: "Search index" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

/** `?tab=`: anything that is not one of the five tabs shows the first. */
export function parseTab(value: string | string[] | undefined): TabKey {
	return TABS.find((tab) => tab.key === value)?.key ?? "waiting";
}

// ?notice= comes back from actions that redirect here. Only these codes become words, so a crafted link cannot put its own message on the page.
const NOTICES: Record<string, string> = {
	"list-restored": "The list was restored. It stays unshared until its owner shares it again.",
};

export function noticeText(code: string | string[] | undefined): string | null {
	return typeof code === "string" && Object.hasOwn(NOTICES, code) ? NOTICES[code] : null;
}

export const TAG_NAME_MAX = 60;

const itemId = itemIdInputSchema.shape.itemId;
const listId = listIdInputSchema.shape.listId;
const id = z.string().min(1).max(120);
// Sending back and taking down tell the owner why, so there is no way to do either without saying.
const reason = z.string().trim().min(1, "A reason is required.").max(REASON_MAX, `A reason can be at most ${REASON_MAX} characters.`);

export const itemInputSchema = z.object({ itemId });
export const itemReasonInputSchema = z.object({ itemId, reason });
export const listInputSchema = z.object({ listId });
export const reportInputSchema = z.object({ reportId: id });
export const reportReasonInputSchema = z.object({ reportId: id, reason });

export const renameTagInputSchema = z.object({
	tagId: id,
	name: z.string().trim().min(1, "A tag name is required.").max(TAG_NAME_MAX, `Tag names can be at most ${TAG_NAME_MAX} characters.`),
});
// An empty group sends the tag back to "Ungrouped".
export const regroupTagInputSchema = z.object({
	tagId: id,
	groupName: z.string().trim().max(TAG_NAME_MAX, `Group names can be at most ${TAG_NAME_MAX} characters.`),
});
export const mergeTagsInputSchema = z.object({ fromId: id, intoId: id }).refine((value) => value.fromId !== value.intoId, {
	message: "Pick two different tags to merge.",
	path: ["intoId"],
});
export const deleteTagInputSchema = z.object({ tagId: id });
