import { describe, expect, it } from "vitest";
import {
	applySearchChange,
	dropStaleFacets,
	effectiveSort,
	facetsFor,
	hasActiveSearch,
	pageInfo,
	parseLibrarySearchParams,
	toggleValue,
	toLibrarySearchParams,
} from "./search-params";

describe("parseLibrarySearchParams", () => {
	it("parses repeatable filters and drops unknown values", () => {
		expect(parseLibrarySearchParams({ q: " burnout ", type: ["code_document", "podcast"], sort: "most_read", page: "3" })).toMatchObject({
			q: "burnout",
			kinds: ["code_document"],
			sort: "most_read",
			offset: 48,
		});
	});

	it("reads one value or many for the repeatable keys, without duplicates", () => {
		const parsed = parseLibrarySearchParams({ type: "guide", source: ["code", "outside", "code", "nope"], tag: ["ltg_a", "ltg_a", "ltg_b"] });
		expect(parsed.kinds).toEqual(["guide"]);
		expect(parsed.sources).toEqual(["code", "outside"]);
		expect(parsed.tagIds).toEqual(["ltg_a", "ltg_b"]);
	});

	it("is empty for no params, and never invents a filter", () => {
		const parsed = parseLibrarySearchParams({});
		expect(parsed).toEqual({ limit: 24, offset: 0, smart: null });
	});

	it("drops an unknown sort, source and facet", () => {
		const parsed = parseLibrarySearchParams({ sort: "random", source: "elsewhere", subtype: "Podcast", format: "Vlog", engagement: "XYZ" });
		expect(parsed.sort).toBeUndefined();
		expect(parsed.sources).toBeUndefined();
		expect(parsed.subtype).toBeUndefined();
		expect(parsed.formatDetail).toBeUndefined();
		expect(parsed.engagementType).toBeUndefined();
	});

	it("keeps a known facet", () => {
		const parsed = parseLibrarySearchParams({ subtype: "Module", format: "SLE", engagement: "C-Team" });
		expect(parsed).toMatchObject({ subtype: "Module", formatDetail: "SLE", engagementType: "C-Team" });
	});

	it.each(["0", "-2", "1.5", "abc", "", "3e2", "99999999999999999999", " 4"])("treats page %j as page 1", (page) => {
		expect(parseLibrarySearchParams({ page }).offset).toBe(0);
	});

	it("uses the first page param when it is repeated", () => {
		expect(parseLibrarySearchParams({ page: ["2", "9"] }).offset).toBe(24);
	});

	it("trims q, drops a blank one and caps it at 200 characters", () => {
		expect(parseLibrarySearchParams({ q: "   " }).q).toBeUndefined();
		expect(parseLibrarySearchParams({ q: "x".repeat(500) }).q).toHaveLength(200);
		expect(parseLibrarySearchParams({ q: ["first", "second"] }).q).toBe("first");
	});

	it("keeps only tag ids shaped like ltg_ ids", () => {
		const parsed = parseLibrarySearchParams({ tag: ["ltg_ok-1_x", "ltg_", "tag_1", "ltg_has space", `ltg_${"a".repeat(61)}`, "ltg_a'; DROP"] });
		expect(parsed.tagIds).toEqual(["ltg_ok-1_x"]);
	});

	it("reads smart as true, false or null", () => {
		expect(parseLibrarySearchParams({ smart: "1" }).smart).toBe(true);
		expect(parseLibrarySearchParams({ smart: "0" }).smart).toBe(false);
		expect(parseLibrarySearchParams({ smart: "yes" }).smart).toBeNull();
		expect(parseLibrarySearchParams({}).smart).toBeNull();
	});
});

describe("toLibrarySearchParams", () => {
	it("round-trips to URL params", () => {
		expect(toLibrarySearchParams({ q: "x", kinds: ["guide"], tagIds: ["ltg_1"] }).toString()).toBe("q=x&type=guide&tag=ltg_1");
	});

	it("writes every key, and the page only past the first", () => {
		const params = toLibrarySearchParams({
			q: "a b",
			kinds: ["guide", "template"],
			sources: ["code"],
			tagIds: ["ltg_1", "ltg_2"],
			subtype: "IDF",
			formatDetail: "SLE",
			engagementType: "STE",
			sort: "newest",
			limit: 24,
			offset: 48,
		});
		expect(params.toString()).toBe("q=a+b&type=guide&type=template&source=code&tag=ltg_1&tag=ltg_2&subtype=IDF&format=SLE&engagement=STE&sort=newest&page=3");
		expect(toLibrarySearchParams({ limit: 24, offset: 0 }).toString()).toBe("");
	});

	it("keeps an explicit smart choice", () => {
		expect(toLibrarySearchParams({ smart: false }).toString()).toBe("smart=0");
		expect(toLibrarySearchParams({ smart: true }).toString()).toBe("smart=1");
	});

	it("parses back what it wrote", () => {
		const input = { q: "turnover", kinds: ["code_document" as const], sources: ["member" as const], tagIds: ["ltg_9"], sort: "most_saved" as const, subtype: "Module", limit: 24, offset: 72 };
		const params = toLibrarySearchParams(input);
		expect(parseLibrarySearchParams(Object.fromEntries([...params].map(([k, v]) => [k, params.getAll(k).length > 1 ? params.getAll(k) : v])))).toMatchObject(input);
	});
});

describe("hasActiveSearch", () => {
	it("is false only for the bare home", () => {
		expect(hasActiveSearch(parseLibrarySearchParams({}))).toBe(false);
		expect(hasActiveSearch(parseLibrarySearchParams({ smart: "0" }))).toBe(false);
		expect(hasActiveSearch(parseLibrarySearchParams({ q: "x" }))).toBe(true);
		expect(hasActiveSearch(parseLibrarySearchParams({ type: "guide" }))).toBe(true);
		expect(hasActiveSearch(parseLibrarySearchParams({ tag: "ltg_1" }))).toBe(true);
		expect(hasActiveSearch(parseLibrarySearchParams({ sort: "newest" }))).toBe(true);
		expect(hasActiveSearch(parseLibrarySearchParams({ page: "2" }))).toBe(true);
	});

	it("ignores params that were all dropped", () => {
		expect(hasActiveSearch(parseLibrarySearchParams({ type: "podcast", q: "  ", sort: "random" }))).toBe(false);
	});
});

describe("facets", () => {
	it("offers the module facets with Module/IDF chosen and book kinds with Book/paper", () => {
		expect(facetsFor({ kinds: ["code_document"] })).toMatchObject({ subtypes: ["IDF", "Module", "Topic Resource"], showSubtype: true, showModuleFacets: true });
		expect(facetsFor({ kinds: ["reading"] })).toMatchObject({ subtypes: ["Book", "Academic Article", "Report", "Other"], showSubtype: true, showModuleFacets: false });
		expect(facetsFor({ kinds: ["guide"] })).toMatchObject({ showSubtype: false, showModuleFacets: false });
	});

	it("still shows a facet that is in the URL without its type", () => {
		expect(facetsFor({ subtype: "Module" }).showSubtype).toBe(true);
		expect(facetsFor({ formatDetail: "SLE" }).showModuleFacets).toBe(true);
		expect(facetsFor({}).showSubtype).toBe(false);
	});

	it("drops a facet when its type is switched off", () => {
		expect(dropStaleFacets({ kinds: ["guide"], subtype: "Module", formatDetail: "SLE", engagementType: "STE" })).toEqual({ kinds: ["guide"] });
		expect(dropStaleFacets({ kinds: ["code_document"], subtype: "Module", formatDetail: "SLE" })).toEqual({ kinds: ["code_document"], subtype: "Module", formatDetail: "SLE" });
		expect(dropStaleFacets({ kinds: ["reading"], subtype: "Module" })).toEqual({ kinds: ["reading"] });
	});

	it("leaves a search with no chosen type alone", () => {
		expect(dropStaleFacets({ subtype: "Module" })).toEqual({ subtype: "Module" });
	});
});

describe("toggleValue", () => {
	it("adds a value, keeps the order, and removes it again", () => {
		expect(toggleValue(undefined, "guide")).toEqual(["guide"]);
		expect(toggleValue(["guide"], "template")).toEqual(["guide", "template"]);
		expect(toggleValue(["guide", "template"], "guide")).toEqual(["template"]);
	});

	it("gives undefined, not an empty list, when the last one goes", () => {
		expect(toggleValue(["guide"], "guide")).toBeUndefined();
	});

	it("does not change its input", () => {
		const list = ["guide"] as const;
		toggleValue(list, "template");
		expect(list).toEqual(["guide"]);
	});
});

describe("applySearchChange", () => {
	it("composes two taps made before the first one came back", () => {
		// Each tap is built from the search as the first tap left it, not from the page the server last sent.
		const server = parseLibrarySearchParams({ q: "burnout" });
		const afterGuide = applySearchChange(server, { kinds: toggleValue(server.kinds, "guide") });
		const afterTemplate = applySearchChange(afterGuide, { kinds: toggleValue(afterGuide.kinds, "template") });
		expect(afterTemplate).toMatchObject({ q: "burnout", kinds: ["guide", "template"], offset: 0 });
		expect(toLibrarySearchParams(afterTemplate).toString()).toBe("q=burnout&type=guide&type=template");
	});

	it("returns to the first page and keeps smart", () => {
		const search = parseLibrarySearchParams({ page: "4", smart: "0" });
		expect(applySearchChange(search, { sort: "most_read" })).toMatchObject({ offset: 0, sort: "most_read", smart: false });
	});

	it("drops a facet the new types do not allow, and keeps one when no type is left", () => {
		const search = parseLibrarySearchParams({ type: "code_document", subtype: "Module", format: "SLE" });
		const next = applySearchChange(search, { kinds: toggleValue(search.kinds, "code_document") });
		expect(next.kinds).toBeUndefined();
		expect(next).toMatchObject({ subtype: "Module", formatDetail: "SLE" });
		const guide = applySearchChange(search, { kinds: ["guide"] });
		expect(guide.subtype).toBeUndefined();
		expect(guide.formatDetail).toBeUndefined();
	});

	it("does not change the search it was given", () => {
		const search = parseLibrarySearchParams({ type: "guide" });
		applySearchChange(search, { kinds: ["template"] });
		expect(search.kinds).toEqual(["guide"]);
	});
});

describe("effectiveSort", () => {
	it("is relevance with a query and newest without one, unless a sort was chosen", () => {
		expect(effectiveSort({ q: "x" })).toBe("relevance");
		expect(effectiveSort({})).toBe("newest");
		expect(effectiveSort({ q: "x", sort: "most_read" })).toBe("most_read");
		expect(effectiveSort({ sort: "most_saved" })).toBe("most_saved");
	});

	it("shows newest for ?sort=relevance without a query", () => {
		expect(effectiveSort(parseLibrarySearchParams({ sort: "relevance" }))).toBe("newest");
		expect(effectiveSort(parseLibrarySearchParams({ sort: "relevance", q: "x" }))).toBe("relevance");
	});
});

describe("pageInfo", () => {
	it("walks the middle, the first and the last page", () => {
		expect(pageInfo(130, 48)).toEqual({ page: 3, pages: 6, prev: 2, next: 4 });
		expect(pageInfo(130, 0)).toEqual({ page: 1, pages: 6, prev: null, next: 2 });
		expect(pageInfo(130, 120)).toEqual({ page: 6, pages: 6, prev: 5, next: null });
	});

	it("counts a partial last page and treats an exact multiple as full", () => {
		expect(pageInfo(25, 0).pages).toBe(2);
		expect(pageInfo(24, 0).pages).toBe(1);
		expect(pageInfo(48, 24)).toEqual({ page: 2, pages: 2, prev: 1, next: null });
	});

	it("points Previous at the last real page from a page past the end", () => {
		expect(pageInfo(130, 24 * 8)).toEqual({ page: 9, pages: 6, prev: 6, next: null });
		expect(pageInfo(5, 24)).toEqual({ page: 2, pages: 1, prev: 1, next: null });
	});

	it("is one empty page with no results", () => {
		expect(pageInfo(0, 0)).toEqual({ page: 1, pages: 1, prev: null, next: null });
		expect(pageInfo(0, 48)).toEqual({ page: 3, pages: 1, prev: 1, next: null });
	});
});
