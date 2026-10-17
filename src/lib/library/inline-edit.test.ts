import { describe, expect, it } from "vitest";
import { parseInline } from "./inline";
import { itemsToText, textToItems, wrapSelection } from "./inline-edit";

describe("wrapSelection", () => {
	it("wraps the selection and selects the wrapped text", () => {
		const result = wrapSelection("say hello now", 4, 9, "bold");
		expect(result.value).toBe("say **hello** now");
		expect(result.value.slice(result.start, result.end)).toBe("hello");
		expect(parseInline(result.value)).toContainEqual({ type: "bold", children: [{ type: "text", text: "hello" }] });
	});

	it("wraps in italics", () => {
		expect(wrapSelection("a b c", 2, 3, "italic").value).toBe("a *b* c");
	});

	it("keeps edge whitespace outside the markers so the pair still parses", () => {
		const result = wrapSelection("a  hello  b", 2, 9, "bold");
		expect(result.value).toBe("a  **hello**  b");
		expect(parseInline(result.value).some((node) => node.type === "bold")).toBe(true);
	});

	it("inserts a placeholder for an empty selection", () => {
		const result = wrapSelection("ab", 1, 1, "italic");
		expect(result.value).toBe("a*italic text*b");
		expect(result.value.slice(result.start, result.end)).toBe("italic text");
	});

	it("treats a whitespace-only selection as empty and does not delete it", () => {
		expect(wrapSelection("a b", 1, 2, "bold").value).toBe("a **bold text**b");
	});

	it("builds a link and selects the stub URL", () => {
		const result = wrapSelection("see docs here", 4, 8, "link");
		expect(result.value).toBe("see [docs](https://) here");
		expect(result.value.slice(result.start, result.end)).toBe("https://");
		// Typing the rest of the address after the stub turns it into a real link.
		const typed = result.value.slice(0, result.end) + "example.org" + result.value.slice(result.end);
		expect(parseInline(typed)).toContainEqual({
			type: "link",
			href: "https://example.org",
			children: [{ type: "text", text: "docs" }],
		});
	});

	it("accepts a backwards selection and clamps out-of-range offsets", () => {
		expect(wrapSelection("abc", 2, 1, "bold").value).toBe("a**b**c");
		expect(wrapSelection("abc", 1, 99, "bold").value).toBe("a**bc**");
	});
});

describe("list text", () => {
	it("round-trips items through one-per-line text", () => {
		expect(textToItems(itemsToText(["a", "", "c"]))).toEqual(["a", "", "c"]);
		expect(textToItems("")).toEqual([""]);
	});

	it("clamps to the schema limits", () => {
		expect(textToItems(Array.from({ length: 120 }, () => "x").join("\n"))).toHaveLength(100);
		expect(textToItems("y".repeat(2500))[0]).toHaveLength(2000);
	});
});
