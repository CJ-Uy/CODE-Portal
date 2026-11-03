import { describe, expect, it } from "vitest";
import { countLinks, filterSections, newLinkIds, type DirectoryLink, type DirectorySection } from "./directory";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-23T12:00:00Z");

function link(id: string, title: string, extra: Partial<DirectoryLink> = {}): DirectoryLink {
	return { id, title, url: `https://example.com/${id}`, description: null, kind: "site", host: "example.com", isNew: false, ...extra };
}

const sections: DirectorySection[] = [
	{
		id: "records",
		name: "Records and trackers",
		links: [
			link("master", "Masterfile", { kind: "sheet", host: "docs.google.com", description: "Every member in one sheet." }),
			link("tracker", "Event tracker", { kind: "sheet", host: "ateneo0.sharepoint.com" }),
		],
	},
	{ id: "forms", name: "Forms", links: [link("reimburse", "Reimbursement request", { kind: "form", host: "forms.gle" })] },
];

describe("filterSections", () => {
	it("returns everything for a blank query", () => {
		expect(filterSections(sections, "   ")).toBe(sections);
	});

	it("matches every word across category, title, description, type and site", () => {
		expect(filterSections(sections, "master SHEET").map((section) => section.links.map((item) => item.id))).toEqual([["master"]]);
		expect(filterSections(sections, "records event").map((section) => section.links.map((item) => item.id))).toEqual([["tracker"]]);
		expect(filterSections(sections, "forms.gle").map((section) => section.id)).toEqual(["forms"]);
		expect(filterSections(sections, "spreadsheet")[0].links).toHaveLength(2);
	});

	it("drops sections with no match", () => {
		expect(filterSections(sections, "budget")).toEqual([]);
		expect(countLinks(filterSections(sections, "form"))).toBe(1);
		expect(countLinks(sections)).toBe(3);
	});
});

describe("newLinkIds", () => {
	it("marks links from the last two weeks once older links exist", () => {
		const ids = newLinkIds(
			[
				{ id: "old", createdAt: new Date(now.getTime() - 40 * day) },
				{ id: "fresh", createdAt: new Date(now.getTime() - 3 * day) },
				{ id: "edge", createdAt: new Date(now.getTime() - 14 * day) },
			],
			now,
		);
		expect([...ids]).toEqual(["fresh"]);
	});

	it("marks nothing when every link is new", () => {
		expect(newLinkIds([{ id: "a", createdAt: new Date(now.getTime() - day) }], now).size).toBe(0);
		expect(newLinkIds([], now).size).toBe(0);
	});
});
