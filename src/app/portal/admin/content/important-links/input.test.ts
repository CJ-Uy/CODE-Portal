import { describe, expect, it } from "vitest";
import { parseArchive, parseCategoryInput, parseLinkInput, parseMove } from "./input";

function form(values: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe("important link form input", () => {
	it("trims fields and turns blank optional fields into null", () => {
		expect(
			parseLinkInput(form({ title: "  Masterfile ", url: " https://docs.google.com/spreadsheets/d/x ", description: "  ", kind: "", categoryId: "" })),
		).toEqual({
			title: "Masterfile",
			url: "https://docs.google.com/spreadsheets/d/x",
			description: null,
			kind: null,
			categoryId: null,
			showInSidebar: false,
		});
	});

	it("keeps a chosen type, category and sidebar pin", () => {
		expect(
			parseLinkInput(
				form({ title: "Apply", url: "https://code.link/apply", description: "Open until Friday.", kind: "form", categoryId: "lcat_forms", showInSidebar: "on" }),
			),
		).toMatchObject({ description: "Open until Friday.", kind: "form", categoryId: "lcat_forms", showInSidebar: true });
	});

	it("rejects missing titles, non-web links, unknown types and long descriptions", () => {
		expect(() => parseLinkInput(form({ title: " ", url: "https://x.test" }))).toThrow();
		expect(() => parseLinkInput(form({ title: "x", url: "javascript:alert(1)" }))).toThrow();
		expect(() => parseLinkInput(form({ title: "x", url: "ftp://files.test/a" }))).toThrow();
		expect(() => parseLinkInput(form({ title: "x", url: "https://x.test", kind: "pdf" }))).toThrow();
		expect(() => parseLinkInput(form({ title: "x", url: "https://x.test", description: "a".repeat(161) }))).toThrow();
	});

	it("parses category names, moves and archive intents", () => {
		expect(parseCategoryInput(form({ name: " Forms " }))).toEqual({ name: "Forms" });
		expect(() => parseCategoryInput(form({ name: "" }))).toThrow();
		expect(parseMove(form({ id: "ilk_a", direction: "down" }))).toEqual({ id: "ilk_a", direction: "down" });
		expect(() => parseMove(form({ id: "ilk_a", direction: "left" }))).toThrow();
		expect(parseArchive(form({ id: "lcat_a", intent: "restore" }))).toEqual({ id: "lcat_a", archived: false });
		expect(() => parseArchive(form({ id: "", intent: "archive" }))).toThrow();
	});
});
