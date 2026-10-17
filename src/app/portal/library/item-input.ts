import { z } from "zod";
import { REPORT_REASONS } from "@/lib/library/taxonomy";
import { itemIdInputSchema } from "./editor-input";

/** Server actions take their input from the browser: every field is checked here, before any repository call. */

const itemId = itemIdInputSchema.shape.itemId;
// A list id, or the literal "saved" for the member's own default list (created on first use).
const listId = z.string().min(1).max(120);
const reason = z.string().trim().max(1000, "A reason can be at most 1000 characters.");

export const toggleSaveInputSchema = z.object({ itemId, listId, saved: z.boolean() });

export const saveToNewListInputSchema = z.object({ itemId, name: z.string().trim().min(1, "Name the list.").max(100, "A list name can be at most 100 characters.") });

export const reportInputSchema = z
	.object({
		itemId: itemId.optional(),
		listId: listId.optional(),
		reason: z.enum(REPORT_REASONS, "Choose a reason for the report."),
		details: z.string().trim().max(1000, "Details can be at most 1000 characters.").optional(),
	})
	.refine((value) => Boolean(value.itemId) !== Boolean(value.listId), { message: "Report one item or one list.", path: ["itemId"] });

export const moderateInputSchema = z
	.object({ itemId, action: z.enum(["approve", "send_back", "take_down", "restore"]), reason: reason.optional() })
	// Sending back or taking down tells the owner why, so there is no way to do either without saying.
	.refine((value) => (value.action !== "send_back" && value.action !== "take_down") || Boolean(value.reason), {
		message: "A reason is required.",
		path: ["reason"],
	});

export const publicReadinessInputSchema = z.object({ itemId, value: z.enum(["not_eligible", "needs_adapting", "public_ready"]).nullable() });

/** "public" stays legal in the database but is neither offered nor settable. */
export const confidentialityInputSchema = z.object({ itemId, value: z.enum(["members", "confidential"]) });

export const deleteInputSchema = z.object({ itemId, confirmTitle: z.string().max(500) });

/**
 * The deleted item's storage keys that are safe to remove: only objects under `library/<itemId>/`. An item's blocks can name
 * any `library/` key, so the list the repository hands back may hold another item's file; that one is never touched.
 */
export function keysUnderItem(itemId: string, keys: string[]): string[] {
	const prefix = `library/${itemId}/`;
	return [...new Set(keys)].filter((key) => key.startsWith(prefix) && key.length > prefix.length && !key.split("/").includes(".."));
}
