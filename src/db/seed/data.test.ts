import { describe, expect, it } from "vitest";
import { RESERVED_SLUG_DEFAULTS } from "@/lib/links";
import { seedLibraryItems, seedLibraryTags, seedLinkDailyStats, seedPointTypes, seedReservedSlugs, seedShortLinks } from "./data";

describe("library seeds", () => {
	it("seeds one synthetic item per format", () => {
		expect(seedLibraryItems.map((item) => item.format).sort()).toEqual(["file", "link", "page"]);
	});

	it("seeds the 37 starting tags with unique ids and slugs", () => {
		expect(seedLibraryTags).toHaveLength(37);
		expect(new Set(seedLibraryTags.map((tag) => tag.id)).size).toBe(37);
		expect(new Set(seedLibraryTags.map((tag) => tag.slug)).size).toBe(37);
		expect(seedLibraryTags[0]).toMatchObject({ id: "ltg_vision_mission_vmos", slug: "vision & mission (vmos)", groupName: "Direction & Strategy" });
	});
});

describe("link seed data", () => {
	it("seeds all route-shadow reserved slugs from the links helper", () => {
		expect(seedReservedSlugs.map((item) => item.slug)).toEqual(RESERVED_SLUG_DEFAULTS);
	});

	it("seeds a preview-ready link with multi-day analytics", () => {
		expect(seedShortLinks[0]).toMatchObject({
			id: "lnk_demo",
			previewTitle: "Welcome to CODE",
			previewDescription: "Ateneo CODE member resources and sign-in.",
			clickCount: 9,
		});
		expect(seedLinkDailyStats).toHaveLength(3);
		expect(new Set(seedLinkDailyStats.map((row) => row.date))).toEqual(new Set(["2026-06-17", "2026-06-18"]));
	});
});

describe("point-type seeds", () => {
	it("provides the three baseline point types", () => {
		expect(seedPointTypes).toEqual([
			expect.objectContaining({ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 0 }),
			expect.objectContaining({ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 1 }),
			expect.objectContaining({ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 2 }),
		]);
	});
});
