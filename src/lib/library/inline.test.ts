import { describe, expect, it } from "vitest";
import { inlineToPlainText, parseInline } from "./inline";

describe("parseInline", () => {
	it("parses bold, italic and safe links", () => {
		expect(parseInline("a **b** *c* [d](https://x.org)")).toEqual([
			{ type: "text", text: "a " },
			{ type: "bold", children: [{ type: "text", text: "b" }] },
			{ type: "text", text: " " },
			{ type: "italic", children: [{ type: "text", text: "c" }] },
			{ type: "text", text: " " },
			{ type: "link", href: "https://x.org", children: [{ type: "text", text: "d" }] },
		]);
	});

	it("keeps unsafe links as literal text", () => {
		expect(parseInline("[x](javascript:alert(1))")).toEqual([{ type: "text", text: "[x](javascript:alert(1))" }]);
		expect(parseInline("[x](http://x.org)")).toEqual([{ type: "text", text: "[x](http://x.org)" }]);
	});

	it("keeps unclosed markers literal", () => {
		expect(parseInline("**open")).toEqual([{ type: "text", text: "**open" }]);
		expect(parseInline("a * b")).toEqual([{ type: "text", text: "a * b" }]);
		expect(parseInline("[label](https://x.org")).toEqual([{ type: "text", text: "[label](https://x.org" }]);
	});

	it("keeps stray asterisks around spaces literal", () => {
		expect(parseInline("2 * 3 * 4")).toEqual([{ type: "text", text: "2 * 3 * 4" }]);
	});

	it("nests formatting inside links and bold", () => {
		expect(parseInline("[**hi**](mailto:a@b.c)")).toEqual([
			{ type: "link", href: "mailto:a@b.c", children: [{ type: "bold", children: [{ type: "text", text: "hi" }] }] },
		]);
		expect(parseInline("**[hi](https://x.org)**")).toEqual([
			{ type: "bold", children: [{ type: "link", href: "https://x.org", children: [{ type: "text", text: "hi" }] }] },
		]);
	});

	it("returns an empty list for empty input", () => {
		expect(parseInline("")).toEqual([]);
	});
});

describe("inlineToPlainText", () => {
	it("strips markup for plain text", () => {
		expect(inlineToPlainText("**Hi** [there](mailto:a@b.c)")).toBe("Hi there");
	});

	it("leaves malformed markup untouched", () => {
		expect(inlineToPlainText("**open and [x](javascript:alert(1))")).toBe("**open and [x](javascript:alert(1))");
	});
});
