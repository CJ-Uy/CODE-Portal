import { describe, expect, it } from "vitest";
import { allFieldErrors, buildPatch, describeErrors, hasUnsaved, normalizeField, type Fields, type PatchContext } from "./editor-patch";

const base: Fields = {
	kind: "guide",
	title: "A title",
	dek: "",
	source: "code",
	authors: [{ name: "Ana", memberId: "mem_1" }],
	subtype: null,
	formatDetail: null,
	engagementType: null,
	year: "",
	url: "",
	blocks: [{ id: "b1", type: "text", props: { text: "Body" } }],
	tagIds: [],
};
const draft: PatchContext = { itemId: "lib_1", format: "page", live: false, had: { link: false, content: true } };
const livePage: PatchContext = { ...draft, live: true };
const liveLink: PatchContext = { itemId: "lib_1", format: "link", live: true, had: { link: true, content: false } };

describe("normalizeField", () => {
	it("drops author rows with no name and trims the rest", () => {
		expect(normalizeField("authors", [{ name: "  Ana  ", memberId: "mem_1" }, { name: "   " }, { name: "" }])).toEqual([{ name: "Ana", memberId: "mem_1" }]);
	});

	it("turns an empty year or link into none", () => {
		expect(normalizeField("year", "")).toBeNull();
		expect(normalizeField("url", "")).toBeNull();
		expect(normalizeField("year", "2024")).toBe("2024");
	});
});

describe("buildPatch", () => {
	it("sends nothing when nothing changed", () => {
		expect(buildPatch(draft, base, base)).toEqual({ patch: null, keys: [], errors: {} });
	});

	it("sends only the fields that changed, in the shape the action takes", () => {
		const { patch, keys, errors } = buildPatch(draft, { ...base, title: " New ", year: "2024", url: "" }, { ...base, url: "" });
		expect(patch).toEqual({ itemId: "lib_1", title: "New", year: 2024 });
		expect(keys).toEqual(["title", "year"]);
		expect(errors).toEqual({});
	});

	it("leaves a blank author row out instead of failing every author edit", () => {
		const now = { ...base, authors: [{ name: "Ana", memberId: "mem_1" }, { name: "  " }, { name: "Bea" }] };
		const { patch, errors } = buildPatch(draft, now, base);
		expect(errors).toEqual({});
		expect(patch?.authors).toEqual([{ name: "Ana", memberId: "mem_1" }, { name: "Bea" }]);
	});

	it("does not call a blank author row a change once the rest is saved", () => {
		const withBlank = { ...base, authors: [...base.authors, { name: "" }] };
		expect(buildPatch(draft, withBlank, base).patch).toBeNull();
		expect(hasUnsaved(draft, withBlank, base)).toBe(false);
	});

	it("keeps a field that is not valid yet out of the patch, names it, and still saves the rest", () => {
		const { patch, keys, errors } = buildPatch(draft, { ...base, title: "Kept", year: "20", url: "http://x.org" }, base);
		expect(patch).toEqual({ itemId: "lib_1", title: "Kept" });
		expect(keys).toEqual(["title"]);
		expect(Object.keys(errors).sort()).toEqual(["url", "year"]);
		expect(describeErrors(errors)).toEqual(["Year: Enter a year from 1900.", "Link address: Use a link that starts with https://"]);
	});

	it("clears a year or link with null", () => {
		const saved = { ...base, year: "2020", url: "https://x.org" };
		expect(buildPatch(draft, { ...base, year: "", url: "" }, saved).patch).toEqual({ itemId: "lib_1", year: null, url: null });
	});

	it("carries the item's format with a type change", () => {
		const reading: PatchContext = { ...draft, format: "link" };
		expect(buildPatch(reading, { ...base, kind: "reading" }, { ...base, kind: "website" }).patch).toEqual({ itemId: "lib_1", kind: "reading", format: "link" });
	});
});

describe("buildPatch on a live item", () => {
	const saved: Fields = { ...base, kind: "website", url: "https://x.org", blocks: [] };

	it("refuses to clear the link of a live link item, and says so", () => {
		const { patch, errors } = buildPatch(liveLink, { ...saved, url: "" }, saved);
		expect(patch).toBeNull();
		expect(errors).toEqual({ url: "Add the link." });
		expect(hasUnsaved(liveLink, { ...saved, url: "" }, saved)).toBe(true);
	});

	it("allows the same edit on a draft", () => {
		expect(buildPatch({ ...liveLink, live: false }, { ...saved, url: "" }, saved).patch).toEqual({ itemId: "lib_1", url: null });
	});

	it("still lets a live link item change to another link", () => {
		expect(buildPatch(liveLink, { ...saved, url: "https://y.org" }, saved).patch).toEqual({ itemId: "lib_1", url: "https://y.org" });
	});

	it("refuses to empty a live page, but not to edit it", () => {
		const emptied = { ...base, blocks: [{ id: "b1", type: "text" as const, props: { text: "  " } }] };
		expect(buildPatch(livePage, emptied, base).errors).toEqual({ blocks: "Write something on the page." });
		expect(buildPatch(draft, emptied, base).errors).toEqual({});
		expect(buildPatch(livePage, { ...base, blocks: [{ id: "b1", type: "text" as const, props: { text: "More" } }] }, base).patch).not.toBeNull();
	});

	it("does not hold a title edit hostage to something that was already missing", () => {
		const broken: PatchContext = { ...livePage, had: { link: false, content: false } };
		const emptyPage = { ...base, blocks: [] };
		const { patch, errors } = buildPatch(broken, { ...emptyPage, title: "Better" }, emptyPage);
		expect(errors).toEqual({});
		expect(patch).toEqual({ itemId: "lib_1", title: "Better" });
	});
});

describe("hasUnsaved", () => {
	it("counts an invalid change as unsaved, so leaving the page is warned about", () => {
		expect(hasUnsaved(draft, { ...base, year: "20" }, base)).toBe(true);
		expect(hasUnsaved(draft, { ...base, title: "Changed" }, base)).toBe(true);
		expect(hasUnsaved(draft, base, base)).toBe(false);
	});
});

describe("allFieldErrors", () => {
	it("lists every invalid field with its label, whether or not it changed", () => {
		const errors = allFieldErrors(draft, { ...base, title: " ", year: "20", url: "ftp://x" });
		expect(describeErrors(errors)).toEqual([
			"Title: A title is required.",
			"Year: Enter a year from 1900.",
			"Link address: Use a link that starts with https://",
		]);
		expect(allFieldErrors(draft, base)).toEqual({});
	});

	it("reuses a blocks result it is given", () => {
		expect(allFieldErrors(draft, base, "Too long")).toEqual({ blocks: "Too long" });
		expect(allFieldErrors(draft, base, null)).toEqual({});
	});
});
