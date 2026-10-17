import { describe, expect, it } from "vitest";
import type { LibraryBlock } from "./blocks";
import { embeddedItemIds, isBlankBlock, paragraphs } from "./block-view";

const block = (type: LibraryBlock["type"], props: object) => ({ id: "b", type, props }) as LibraryBlock;

describe("isBlankBlock", () => {
	it("treats whitespace-only text-like blocks as blank", () => {
		for (const type of ["heading", "text", "callout", "quote"] as const) {
			expect(isBlankBlock(block(type, { text: " \n " }))).toBe(true);
			expect(isBlankBlock(block(type, { text: "hi" }))).toBe(false);
		}
	});

	it("is blank when every list item is blank", () => {
		expect(isBlankBlock(block("list", { ordered: false, items: ["", "  "] }))).toBe(true);
		expect(isBlankBlock(block("list", { ordered: false, items: ["", "a"] }))).toBe(false);
	});

	it("is blank for empty code", () => {
		expect(isBlankBlock(block("code", { code: "\n" }))).toBe(true);
		expect(isBlankBlock(block("code", { code: "x" }))).toBe(false);
	});

	it("never calls image, divider, item or link blank", () => {
		expect(isBlankBlock(block("divider", {}))).toBe(false);
		expect(isBlankBlock(block("item", { itemId: "i" }))).toBe(false);
		expect(isBlankBlock(block("image", { key: "k", alt: "" }))).toBe(false);
		expect(isBlankBlock(block("link", { url: "https://x.org", title: "" }))).toBe(false);
	});
});

describe("paragraphs", () => {
	it("splits on blank lines and keeps single line breaks", () => {
		expect(paragraphs("a\nb\n\nc")).toEqual(["a\nb", "c"]);
	});

	it("treats a whitespace-only line, CRLF and extra blank lines as one break", () => {
		expect(paragraphs("a\n  \nb")).toEqual(["a", "b"]);
		expect(paragraphs("a\r\n\r\nb")).toEqual(["a", "b"]);
		expect(paragraphs("a\n\n\n\nb")).toEqual(["a", "b"]);
	});

	it("drops empty paragraphs and trims", () => {
		expect(paragraphs("")).toEqual([]);
		expect(paragraphs("\n\n  \n\n")).toEqual([]);
		expect(paragraphs("  a  ")).toEqual(["a"]);
	});
});

describe("embeddedItemIds", () => {
	it("lists each embedded item once, in page order", () => {
		const blocks = [
			{ ...block("item", { itemId: "lib_b" }), id: "1" },
			block("text", { text: "hi" }),
			{ ...block("item", { itemId: "lib_a" }), id: "2" },
			{ ...block("item", { itemId: "lib_b" }), id: "3" },
		];
		expect(embeddedItemIds(blocks)).toEqual(["lib_b", "lib_a"]);
		expect(embeddedItemIds([])).toEqual([]);
	});
});
