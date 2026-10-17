import { z, type ZodError } from "zod";
import { isBlankBlock } from "@/lib/library/block-view";
import { libraryBlocksSchema, type LibraryBlock } from "@/lib/library/blocks";
import { allowedFormats, ENGAGEMENT_TYPES, FORMAT_DETAILS, LIBRARY_KINDS, SUBTYPES, type LibraryFormat, type LibraryStatus } from "@/lib/library/taxonomy";

/** A D1 row tops out near 2 MB; the rest of the row (title, summary, search text, authors) needs room. */
export const MAX_BLOCKS_BYTES = 1_500_000;
/** Matches the repository's per-item cap (it also keeps the tag insert inside D1's bind limit). */
export const MAX_TAGS = 40;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Keep in step with libraryFileTypes in src/server/uploads.ts: the upload route is the source of truth for what is stored.
export const LIBRARY_FILE_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const utf8 = new TextEncoder();

const itemId = z
	.string()
	.regex(/^[A-Za-z0-9._-]{1,80}$/, "Unknown library item.")
	.refine((value) => !value.includes(".."), "Unknown library item.");

const kind = z.enum(LIBRARY_KINDS);
const format = z.enum(["file", "page", "link"]);
const title = z.string().trim().min(1, "A title is required.").max(200, "Titles can be at most 200 characters.");

const httpsUrl = z
	.string()
	.trim()
	.max(2000, "Links can be at most 2000 characters.")
	.regex(/^https:\/\/\S+$/i, "Use a link that starts with https://");
// A cleared field arrives as "" and means no link.
const url = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), httpsUrl.nullable());

// z.coerce keeps a form string usable, and rejects NaN (Number("abc")), so a bad year can never reach the repository.
const year = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? null : value),
	z.coerce.number("Enter a year.").int("Enter a whole year.").min(1900, "Enter a year from 1900.").max(2100, "Enter a year up to 2100.").nullable(),
);

const blocks = libraryBlocksSchema.refine((value) => utf8.encode(JSON.stringify(value)).length <= MAX_BLOCKS_BYTES, {
	message: "This page is too long to save. Shorten it or split it into two pages.",
});

const authors = z
	.array(z.object({ name: z.string().trim().min(1, "Every author needs a name.").max(120), memberId: z.string().min(1).max(80).optional() }))
	.max(20, "An item can credit at most 20 authors.");

/** Every field but the id is optional: autosave sends only what changed. Anything not listed here (status, owner, flags) cannot be sent. */
export const saveItemInputSchema = z
	.object({
		itemId,
		kind: kind.optional(),
		/** Only ever sent with a kind change, to keep a Book/paper a link or a Case study a file. */
		format: format.optional(),
		title: title.optional(),
		dek: z.string().trim().max(500, "The summary can be at most 500 characters.").optional(),
		source: z.enum(["code", "member", "outside"]).optional(),
		authors: authors.optional(),
		subtype: z.enum([...SUBTYPES.code_document, ...SUBTYPES.reading]).nullable().optional(),
		formatDetail: z.enum(FORMAT_DETAILS).nullable().optional(),
		engagementType: z.enum(ENGAGEMENT_TYPES).nullable().optional(),
		year: year.optional(),
		url: url.optional(),
		blocks: blocks.optional(),
		tagIds: z.array(z.string().min(1).max(80)).max(MAX_TAGS, `An item can have at most ${MAX_TAGS} tags.`).optional(),
	})
	// A format on its own would swap the body of an item (a file for a link) without a type change to explain it.
	.refine((value) => value.format === undefined || value.kind !== undefined, {
		message: "The format only changes together with the type.",
		path: ["format"],
	});
export type SaveItemInput = z.infer<typeof saveItemInputSchema>;

/** The /new forms: `Object.fromEntries(formData)` is enough, extra keys are dropped. */
export const createDraftInputSchema = z
	.object({
		kind,
		format: format.optional(),
		title,
		listId: z
			.string()
			.trim()
			.max(80)
			.transform((value) => value || undefined)
			.optional(),
	})
	.refine((value) => !value.format || allowedFormats(value.kind).includes(value.format), {
		message: "That type cannot be used with this format.",
		path: ["format"],
	});

export const itemIdInputSchema = z.object({ itemId });

export const publishInputSchema = z.object({ itemId, containsClientData: z.boolean() });

export const tagNameSchema = z.string().trim().min(1, "A tag name is required.").max(60, "Tag names can be at most 60 characters.");

const extensionOf = (key: string) => key.slice(key.lastIndexOf(".") + 1).toLowerCase();

export const attachFileInputSchema = z
	.object({
		itemId,
		key: z.string().max(300),
		name: z.string().trim().min(1, "The file needs a name.").max(255),
		type: z.string().max(200),
		bytes: z.number().int().min(1).max(MAX_FILE_BYTES),
	})
	// The key's extension is what the upload route verified; the type the browser reports must agree with it.
	.refine((value) => LIBRARY_FILE_TYPES[extensionOf(value.key)] === value.type, { message: "Unsupported file type.", path: ["type"] });

/** The upload route files an upload under `library/<itemId>/<memberId>/<file>`; this is how an attach proves the key is the actor's, for that item. */
export function isOwnFileKey(key: string, itemId: string, memberId: string): boolean {
	const prefix = `library/${itemId}/${memberId}/`;
	return key.startsWith(prefix) && !key.includes("..") && /^[A-Za-z0-9._-]+$/.test(key.slice(prefix.length));
}

/** What a draft still lacks before it can go out; empty means ready. The publish dialog and publishAction both ask. */
export function publishProblems(item: { format: LibraryFormat; title: string; fileKey: string | null; url: string | null; blocks: LibraryBlock[] }): string[] {
	const problems: string[] = [];
	if (!item.title.trim()) problems.push("Add a title.");
	if (item.format === "file" && !item.fileKey) problems.push("Upload the file.");
	if (item.format === "link" && !item.url) problems.push("Add the link.");
	if (item.format === "page" && item.blocks.every(isBlankBlock)) problems.push("Write something on the page.");
	return problems;
}

/** A server action that throws shows members a generic "Server Components render" message in production; say something useful instead. */
export function actionErrorMessage(error: unknown, fallback: string): string {
	const message = error instanceof Error ? error.message : "";
	return message && message.length < 200 && !/Server Components|digest|fetch failed/i.test(message) ? message : fallback;
}

type LiveBody = { status: LibraryStatus; format: LibraryFormat; title: string; fileKey: string | null; url: string | null; blocks: LibraryBlock[] };

/**
 * What an edit would take away from an item that is already out of draft: its title, its link or its page.
 * A draft may be half-built, so it returns nothing. A live item that was already missing something is not
 * blamed for it; only a problem the edit introduces counts. saveItemAction refuses the save on any of these.
 */
export function editProblems(current: LiveBody, next: { title?: string; url?: string | null; blocks?: LibraryBlock[] }): string[] {
	if (current.status === "draft") return [];
	const before = publishProblems(current);
	const after = publishProblems({
		format: current.format,
		title: next.title ?? current.title,
		fileKey: current.fileKey,
		url: next.url === undefined ? current.url : next.url,
		blocks: next.blocks ?? current.blocks,
	});
	return after.filter((problem) => !before.includes(problem));
}

/** Why /new refused a form, as a fixed code: the page turns it into a sentence, so a crafted link cannot put its own words on the page. */
export type DraftProblem = "title" | "kind" | "format" | "invalid";

export function draftProblem(error: ZodError): DraftProblem {
	const field = error.issues[0]?.path[0];
	return field === "title" || field === "kind" || field === "format" ? field : "invalid";
}
