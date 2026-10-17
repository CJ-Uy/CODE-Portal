import { z } from "zod";
import { itemIdInputSchema } from "./editor-input";

/** Server actions take their input from the browser: every field is checked here, before any repository call. */

// Matches the repository's own limits, so a form that passes here is never refused for length later.
export const LIST_NAME_MAX = 100;
export const LIST_DESCRIPTION_MAX = 1000;
export const NOTE_MAX = 2000;
export const COMMENT_MAX = 4000;
export const REASON_MAX = 500;
/** One reorder rewrites every row of the list in one batch, so the batch is capped. */
export const REORDER_MAX = 500;

const listId = z.string().min(1).max(120);
const memberId = z.string().min(1).max(120);
const itemId = itemIdInputSchema.shape.itemId;
const commentId = z.string().min(1).max(120);

const name = z.string().trim().min(1, "A list name is required.").max(LIST_NAME_MAX, `List names can be at most ${LIST_NAME_MAX} characters.`);
const description = z.string().trim().max(LIST_DESCRIPTION_MAX, `Descriptions can be at most ${LIST_DESCRIPTION_MAX} characters.`);
// The color ends up in an inline style, so only a plain hex value gets through.
const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a color like #0c315c.");

export const createListInputSchema = z.object({ name, description: description.optional() });

export const updateListInputSchema = z
	.object({ listId, name: name.optional(), description: description.optional(), color: color.optional() })
	.refine((value) => value.name !== undefined || value.description !== undefined || value.color !== undefined, { message: "Nothing to change.", path: ["name"] });

export const listIdInputSchema = z.object({ listId });

export const setSharedInputSchema = z.object({ listId, shared: z.boolean() });

export const editorInputSchema = z.object({ listId, memberId });

export const listItemInputSchema = z.object({ listId, itemId });

/** An empty note clears it. */
export const setNoteInputSchema = z.object({ listId, itemId, note: z.string().trim().max(NOTE_MAX, `Notes can be at most ${NOTE_MAX} characters.`) });

export const reorderInputSchema = z.object({ listId, itemIds: z.array(itemId).max(REORDER_MAX, `A list can be reordered up to ${REORDER_MAX} items at a time.`) });

export const addListCommentInputSchema = z.object({
	listId,
	parentId: z.string().min(1).max(120).nullish(),
	anonymous: z.boolean(),
	body: z.string().trim().min(1, "Write something first.").max(COMMENT_MAX, `Comments can be at most ${COMMENT_MAX} characters.`),
});

export const setCommentHiddenInputSchema = z.object({ listId, commentId, hidden: z.boolean() });

/** `pinOrder` is optional: a list pinned without one goes last. Lower numbers show first. */
export const setPinnedInputSchema = z.object({
	listId,
	pinned: z.boolean(),
	pinOrder: z.number("Enter a whole number.").int("Enter a whole number.").min(-100_000).max(100_000).optional(),
});

export const takeDownInputSchema = z.object({ listId, reason: z.string().trim().min(1, "A reason is required.").max(REASON_MAX, `Reasons can be at most ${REASON_MAX} characters.`) });
