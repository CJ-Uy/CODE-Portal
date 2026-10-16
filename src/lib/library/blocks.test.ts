import { describe, expect, it } from "vitest";
import {
	blocksToPlainText,
	libraryBlockSchema,
	libraryBlocksSchema,
	newLibraryBlock,
	readMinutes,
	type LibraryBlockType,
} from "./blocks";

const TYPES: LibraryBlockType[] = ["heading", "text", "list", "quote", "callout", "code", "image", "divider", "item", "link"];

describe("libraryBlockSchema", () => {
	it("rejects non-https links and more than 300 blocks", () => {
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "link", props: { url: "http://x.org", title: "x" } }).success).toBe(false);
		expect(libraryBlocksSchema.safeParse(Array.from({ length: 301 }, (_, i) => ({ id: `b${i}`, type: "divider", props: {} }))).success).toBe(false);
		expect(libraryBlocksSchema.safeParse(Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, type: "divider", props: {} }))).success).toBe(true);
	});

	it("accepts an https link block", () => {
		expect(
			libraryBlockSchema.safeParse({ id: "b1", type: "link", props: { url: "https://x.org", title: "x", description: "d" } }).success,
		).toBe(true);
	});

	it("enforces field limits", () => {
		const text = (n: number) => libraryBlockSchema.safeParse({ id: "b1", type: "text", props: { text: "a".repeat(n) } }).success;
		expect(text(10_000)).toBe(true);
		expect(text(10_001)).toBe(false);

		const list = (items: string[]) => libraryBlockSchema.safeParse({ id: "b1", type: "list", props: { ordered: false, items } }).success;
		expect(list(Array.from({ length: 100 }, () => "a"))).toBe(true);
		expect(list(Array.from({ length: 101 }, () => "a"))).toBe(false);
		expect(list(["a".repeat(2000)])).toBe(true);
		expect(list(["a".repeat(2001)])).toBe(false);

		const code = (n: number) => libraryBlockSchema.safeParse({ id: "b1", type: "code", props: { code: "a".repeat(n) } }).success;
		expect(code(20_000)).toBe(true);
		expect(code(20_001)).toBe(false);

		const image = (alt: string, caption?: string) =>
			libraryBlockSchema.safeParse({ id: "b1", type: "image", props: { key: "library/a/b/c.png", alt, caption } }).success;
		expect(image("a".repeat(200))).toBe(true);
		expect(image("a".repeat(201))).toBe(false);
		expect(image("ok", "a".repeat(300))).toBe(true);
		expect(image("ok", "a".repeat(301))).toBe(false);

		const title = (n: number) => libraryBlockSchema.safeParse({ id: "b1", type: "link", props: { url: "https://x.org", title: "a".repeat(n) } }).success;
		expect(title(200)).toBe(true);
		expect(title(201)).toBe(false);
	});

	it("only accepts library image keys", () => {
		const key = (k: string) => libraryBlockSchema.safeParse({ id: "b1", type: "image", props: { key: k, alt: "" } }).success;
		expect(key("library/abc/def/photo.png")).toBe(true);
		expect(key("library/abc/photo.png")).toBe(false);
		expect(key("other/abc/def/photo.png")).toBe(false);
		expect(key("library/abc/def/ph oto.png")).toBe(false);
		expect(key("library/abc/def/photo.png/extra")).toBe(false);
		expect(key("https://x.org/a.png")).toBe(false);
	});

	it("rejects unknown block types and a divider with props", () => {
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "script", props: {} }).success).toBe(false);
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "divider", props: { x: 1 } }).success).toBe(false);
	});

	it("only allows heading levels 2 and 3 and callout tones note/tip", () => {
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "heading", props: { text: "h", level: 1 } }).success).toBe(false);
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "heading", props: { text: "h", level: 3 } }).success).toBe(true);
		expect(libraryBlockSchema.safeParse({ id: "b1", type: "callout", props: { tone: "warn", text: "t" } }).success).toBe(false);
	});
});

describe("newLibraryBlock", () => {
	it.each(TYPES)("creates a %s block with a blk_ id", (type) => {
		const block = newLibraryBlock(type);
		expect(block.type).toBe(type);
		expect(block.id).toMatch(/^blk_[0-9a-f]{10}$/);
	});

	it.each(TYPES.filter((type) => !["image", "item", "link"].includes(type)))("creates a %s block that already validates", (type) => {
		expect(libraryBlockSchema.safeParse(newLibraryBlock(type)).success).toBe(true);
	});

	it("starts image, item and link incomplete, valid once their required field is filled", () => {
		for (const type of ["image", "item", "link"] as const) {
			expect(libraryBlockSchema.safeParse(newLibraryBlock(type)).success).toBe(false);
		}
		const image = newLibraryBlock("image");
		const item = newLibraryBlock("item");
		const link = newLibraryBlock("link");
		expect(libraryBlockSchema.safeParse({ ...image, props: { ...image.props, key: "library/a/b/c.png" } }).success).toBe(true);
		expect(libraryBlockSchema.safeParse({ ...item, props: { itemId: "itm_1" } }).success).toBe(true);
		expect(libraryBlockSchema.safeParse({ ...link, props: { ...link.props, url: "https://x.org" } }).success).toBe(true);
	});

	it("gives each block a distinct id", () => {
		expect(newLibraryBlock("text").id).not.toBe(newLibraryBlock("text").id);
	});
});

describe("blocksToPlainText", () => {
	it("flattens blocks to plain text for search", () => {
		const text = blocksToPlainText([
			{ id: "1", type: "heading", props: { text: "Plan", level: 2 } },
			{ id: "2", type: "list", props: { ordered: false, items: ["**one**", "two"] } },
			{ id: "3", type: "image", props: { key: "library/a/b/c.png", alt: "diagram" } },
		]);
		expect(text).toBe("Plan\n\none\ntwo\n\ndiagram");
	});

	it("covers the remaining block types", () => {
		const text = blocksToPlainText([
			{ id: "1", type: "text", props: { text: "See [the guide](https://x.org) *now*" } },
			{ id: "2", type: "quote", props: { text: "Quoted", cite: "Someone" } },
			{ id: "3", type: "callout", props: { tone: "tip", text: "**Tip** here" } },
			{ id: "4", type: "code", props: { code: "const a = 1;" } },
			{ id: "5", type: "divider", props: {} },
			{ id: "6", type: "item", props: { itemId: "itm_1" } },
			{ id: "7", type: "link", props: { url: "https://x.org", title: "Site", description: "About it" } },
			{ id: "8", type: "link", props: { url: "https://y.org", title: "Bare" } },
		]);
		expect(text).toBe("See the guide now\n\nQuoted\nSomeone\n\nTip here\n\nconst a = 1;\n\nSite\nAbout it\n\nBare");
	});

	it("returns an empty string for no blocks", () => {
		expect(blocksToPlainText([])).toBe("");
	});
});

describe("readMinutes", () => {
	it("computes read minutes with a floor of 1", () => {
		expect(readMinutes("word ".repeat(50))).toBe(1);
		expect(readMinutes("word ".repeat(1000))).toBe(5);
		expect(readMinutes("")).toBe(1);
	});
});
