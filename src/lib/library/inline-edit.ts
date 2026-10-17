/**
 * Editing helpers for the library block editor's text fields: the formatting
 * toolbar and the one-item-per-line list field. Pure, so the Workers pool can test them.
 */
export type InlineMark = "bold" | "italic" | "link";

export type WrapResult = { value: string; start: number; end: number };

const PLACEHOLDER: Record<InlineMark, string> = { bold: "bold text", italic: "italic text", link: "link text" };
const URL_STUB = "https://";

/**
 * Wraps the selection in `**…**`, `*…*` or `[…](https://)` and returns where the
 * caret should select next (the text for bold and italic, the URL for a link).
 * Edge whitespace stays outside the markers, because parseInline only reads a
 * pair that hugs its content. An empty selection inserts a placeholder.
 */
export function wrapSelection(value: string, start: number, end: number, mark: InlineMark): WrapResult {
	const lo = Math.max(0, Math.min(start, end, value.length));
	const hi = Math.min(value.length, Math.max(start, end));
	const picked = value.slice(lo, hi);
	const label = picked.trim();
	const from = label ? lo + picked.length - picked.trimStart().length : hi;
	const to = label ? from + label.length : hi;
	const text = label || PLACEHOLDER[mark];

	const [open, close] = mark === "bold" ? ["**", "**"] : mark === "italic" ? ["*", "*"] : ["[", `](${URL_STUB})`];
	const next = value.slice(0, from) + open + text + close + value.slice(to);

	if (mark === "link") {
		const urlStart = from + open.length + text.length + 2;
		return { value: next, start: urlStart, end: urlStart + URL_STUB.length };
	}
	return { value: next, start: from + open.length, end: from + open.length + text.length };
}

const LIST_MAX_ITEMS = 100;
const LIST_ITEM_MAX = 2000;

export const itemsToText = (items: string[]): string => items.join("\n");

/** One item per line, cut to the schema's limits (100 items, 2000 characters each). */
export const textToItems = (text: string): string[] =>
	text
		.split("\n")
		.slice(0, LIST_MAX_ITEMS)
		.map((line) => line.slice(0, LIST_ITEM_MAX));
