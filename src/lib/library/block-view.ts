import type { LibraryBlock } from "./blocks";

/** A block with nothing to show. The reader skips it and the editor shows a hint instead. */
export function isBlankBlock(block: LibraryBlock): boolean {
	switch (block.type) {
		case "heading":
		case "text":
		case "callout":
		case "quote":
			return !block.props.text.trim();
		case "list":
			return block.props.items.every((item) => !item.trim());
		case "code":
			return !block.props.code.trim();
		default:
			return false;
	}
}

/** The distinct ids of the library items a page embeds, in page order. */
export function embeddedItemIds(blocks: LibraryBlock[]): string[] {
	return [...new Set(blocks.flatMap((block) => (block.type === "item" ? [block.props.itemId] : [])))];
}

/**
 * Paragraphs of a text field: a blank line (which may hold spaces) ends one.
 * Single line breaks stay inside the paragraph, and empty paragraphs are dropped.
 */
export function paragraphs(text: string): string[] {
	return text
		.split(/\r?\n[ \t]*\r?\n/)
		.map((part) => part.trim())
		.filter(Boolean);
}
