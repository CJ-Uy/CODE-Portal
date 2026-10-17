import { z } from "zod";
import { inlineToPlainText } from "./inline";

export type LibraryBlock =
	| { id: string; type: "heading"; props: { text: string; level: 2 | 3 } }
	| { id: string; type: "text"; props: { text: string } }
	| { id: string; type: "list"; props: { ordered: boolean; items: string[] } }
	| { id: string; type: "quote"; props: { text: string; cite?: string } }
	| { id: string; type: "callout"; props: { tone: "note" | "tip"; text: string } }
	| { id: string; type: "code"; props: { code: string; language?: string } }
	| { id: string; type: "image"; props: { key: string; alt: string; caption?: string } }
	| { id: string; type: "divider"; props: Record<string, never> }
	| { id: string; type: "item"; props: { itemId: string } }
	| { id: string; type: "link"; props: { url: string; title: string; description?: string } };

export type LibraryBlockType = LibraryBlock["type"];

const id = z.string().min(1).max(40);
const text = z.string().max(10_000);
const httpsUrl = z
	.string()
	.trim()
	.max(2000)
	.refine((value) => /^https:\/\/\S+$/i.test(value), "Use a link that starts with https://");
// library/<itemId>/<memberId>/<file>, the shape the upload route writes.
const imageKey = z
	.string()
	.max(1024)
	.regex(/^library\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "Use an uploaded library image");

export const libraryBlockSchema = z.discriminatedUnion("type", [
	z.object({ id, type: z.literal("heading"), props: z.object({ text: z.string().max(200), level: z.union([z.literal(2), z.literal(3)]) }) }),
	z.object({ id, type: z.literal("text"), props: z.object({ text }) }),
	z.object({
		id,
		type: z.literal("list"),
		props: z.object({ ordered: z.boolean(), items: z.array(z.string().max(2000)).max(100) }),
	}),
	z.object({ id, type: z.literal("quote"), props: z.object({ text, cite: z.string().max(200).optional() }) }),
	z.object({ id, type: z.literal("callout"), props: z.object({ tone: z.enum(["note", "tip"]), text }) }),
	z.object({
		id,
		type: z.literal("code"),
		props: z.object({ code: z.string().max(20_000), language: z.string().max(40).optional() }),
	}),
	z.object({
		id,
		type: z.literal("image"),
		props: z.object({ key: imageKey, alt: z.string().max(200), caption: z.string().max(300).optional() }),
	}),
	z.object({ id, type: z.literal("divider"), props: z.strictObject({}) }),
	z.object({ id, type: z.literal("item"), props: z.object({ itemId: z.string().min(1).max(80) }) }),
	z.object({
		id,
		type: z.literal("link"),
		props: z.object({ url: httpsUrl, title: z.string().max(200), description: z.string().max(2000).optional() }),
	}),
]) satisfies z.ZodType<LibraryBlock>;

export const libraryBlocksSchema = z.array(libraryBlockSchema).max(300);

const blockId = () => `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

/**
 * Default content for a block added from the palette. Image, item and link
 * start with their required field empty; the editor fills it before they validate.
 */
export function newLibraryBlock(type: LibraryBlockType): LibraryBlock {
	switch (type) {
		case "heading":
			return { id: blockId(), type, props: { text: "Heading", level: 2 } };
		case "text":
			return { id: blockId(), type, props: { text: "" } };
		case "list":
			return { id: blockId(), type, props: { ordered: false, items: [""] } };
		case "quote":
			return { id: blockId(), type, props: { text: "" } };
		case "callout":
			return { id: blockId(), type, props: { tone: "note", text: "" } };
		case "code":
			return { id: blockId(), type, props: { code: "" } };
		case "image":
			return { id: blockId(), type, props: { key: "", alt: "" } };
		case "divider":
			return { id: blockId(), type, props: {} };
		case "item":
			return { id: blockId(), type, props: { itemId: "" } };
		case "link":
			return { id: blockId(), type, props: { url: "", title: "" } };
	}
}

function blockToPlainText(block: LibraryBlock): string {
	switch (block.type) {
		case "heading":
		case "text":
		case "callout":
			return inlineToPlainText(block.props.text);
		case "list":
			return block.props.items.map(inlineToPlainText).join("\n");
		case "quote":
			return [block.props.text, block.props.cite ?? ""].map(inlineToPlainText).filter(Boolean).join("\n");
		case "code":
			return block.props.code;
		case "image":
			return [block.props.alt, block.props.caption].filter(Boolean).join("\n");
		case "link":
			return [block.props.title, block.props.description].filter(Boolean).join("\n");
		case "divider":
		case "item":
			return "";
	}
}

/** Markup stripped, blocks joined by a blank line. Feeds search text and read time. */
export function blocksToPlainText(blocks: LibraryBlock[]): string {
	return blocks.map(blockToPlainText).filter(Boolean).join("\n\n");
}

const EXTRACTED_TEXT_INDEX_CAP = 200_000;
// ponytail: search text stops at 300 KB (UTF-8) so a 1.5 MB page plus its search text fits D1's 2 MB row; words past
// that are not found by plain search. Move search_text to its own table (or FTS5) if huge pages need full coverage.
export const SEARCH_TEXT_MAX_BYTES = 300_000;

/** The longest prefix of `text` that is at most `maxBytes` in UTF-8, never cutting a character in half. */
function clipUtf8(text: string, maxBytes: number): string {
	if (text.length * 3 <= maxBytes) return text;
	return text.slice(0, new TextEncoder().encodeInto(text, new Uint8Array(maxBytes)).read);
}

/** searchText = lower(title, summary, file code, authors, tags, block text, extracted text up to 200k chars), at most 300 KB. The seed import uses it too. */
export function buildSearchText(
	item: {
		title: string;
		dek: string;
		fileCode: string | null;
		authorsJson: { name: string }[];
		blocksJson: LibraryBlock[];
		extractedText: string;
	},
	tagNames: string[],
): string {
	const text = [
		item.title,
		item.dek,
		item.fileCode,
		...item.authorsJson.map((author) => author.name),
		...tagNames,
		blocksToPlainText(item.blocksJson),
		item.extractedText.slice(0, EXTRACTED_TEXT_INDEX_CAP),
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
	return clipUtf8(text, SEARCH_TEXT_MAX_BYTES);
}

/** Reading time at 200 words a minute, never less than one. */
export function readMinutes(text: string): number {
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(words / 200));
}
