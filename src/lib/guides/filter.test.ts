import { describe, expect, it } from "vitest";
import { GUIDES } from "./content";
import { filterByAudience, neighbours, parseAudience, searchGuides, visibleGuides, type GuideAccess } from "./filter";

const ALL_ON: GuideAccess = { canAdmin: true, surveys: true, retention: true };
const slugs = (list: { slug: string }[]) => list.map((guide) => guide.slug);
const ALWAYS = ["check-in", "sign-up", "create-event", "take-attendance"];

describe("visibleGuides", () => {
	it("shows every guide to an admin when the flags are on", () => {
		expect(slugs(visibleGuides(GUIDES, ALL_ON))).toEqual(slugs(GUIDES));
	});

	it("hides admin guides from members without survey:configure", () => {
		const list = visibleGuides(GUIDES, { ...ALL_ON, canAdmin: false });
		expect(list.some((guide) => guide.audience === "admin")).toBe(false);
		expect(slugs(list)).toContain("give-feedback");
		expect(slugs(list)).toContain("organizer-feedback");
	});

	it("hides admin and feedback guides when surveys is off, even for admins", () => {
		const list = slugs(visibleGuides(GUIDES, { ...ALL_ON, surveys: false }));
		expect(list).not.toContain("send-form");
		expect(list).not.toContain("read-results");
		expect(list).not.toContain("give-feedback");
		expect(list).not.toContain("organizer-feedback");
		expect(list).toContain("retention");
	});

	it("hides the retention guide when retention is off", () => {
		expect(slugs(visibleGuides(GUIDES, { ...ALL_ON, retention: false }))).not.toContain("retention");
	});

	it("always shows the guides that need no flag", () => {
		const list = slugs(visibleGuides(GUIDES, { canAdmin: false, surveys: false, retention: false }));
		expect(list).toEqual(ALWAYS);
	});
});

describe("searchGuides", () => {
	it("keeps everything for an empty or blank query", () => {
		expect(searchGuides(GUIDES, "")).toHaveLength(GUIDES.length);
		expect(searchGuides(GUIDES, "  - ")).toHaveLength(GUIDES.length);
	});

	it("matches case-insensitively and treats hyphens as spaces", () => {
		expect(slugs(searchGuides(GUIDES, "CHECK-IN"))).toEqual(["check-in"]);
		expect(slugs(searchGuides(GUIDES, "Check In"))).toEqual(["check-in"]);
		expect(slugs(searchGuides(GUIDES, "retention POINTS"))).toEqual(["retention"]);
	});

	it("matches step titles, not just the title and summary", () => {
		expect(slugs(searchGuides(GUIDES, "quick actions"))).toEqual(["create-event"]);
	});

	it("matches the start of a word, not the middle", () => {
		expect(slugs(searchGuides(GUIDES, "attend"))).toContain("take-attendance");
		expect(searchGuides(GUIDES, "ention")).toEqual([]);
	});

	it("needs every word to match", () => {
		expect(searchGuides(GUIDES, "debrief template")).toEqual([]);
		expect(searchGuides(GUIDES, "zzz")).toEqual([]);
	});
});

describe("audience filter", () => {
	it("parses only known audiences", () => {
		expect(parseAudience("organizer")).toBe("organizer");
		expect(parseAudience("Organizer")).toBeUndefined();
		expect(parseAudience(["admin"])).toBeUndefined();
		expect(parseAudience(undefined)).toBeUndefined();
	});

	it("filters by audience and keeps all without one", () => {
		expect(slugs(filterByAudience(GUIDES, "organizer"))).toEqual(["take-attendance", "organizer-feedback"]);
		expect(filterByAudience(GUIDES, undefined)).toHaveLength(GUIDES.length);
	});
});

describe("neighbours", () => {
	const list = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];

	it("returns the guides either side", () => {
		expect(neighbours("b", list)).toEqual({ prev: { slug: "a" }, next: { slug: "c" } });
		expect(neighbours("a", list)).toEqual({ prev: undefined, next: { slug: "b" } });
		expect(neighbours("c", list)).toEqual({ prev: { slug: "b" }, next: undefined });
	});

	it("returns nothing for an unknown slug", () => {
		expect(neighbours("x", list)).toEqual({});
	});
});

describe("guide content", () => {
	it("has unique slugs and images under each guide's own folder", () => {
		expect(new Set(slugs(GUIDES)).size).toBe(GUIDES.length);
		for (const guide of GUIDES) {
			expect(guide.steps.length).toBeGreaterThan(0);
			for (const step of guide.steps) {
				if (!step.image) continue;
				expect(step.image.src.startsWith(`/guides/${guide.slug}/`)).toBe(true);
				expect(step.image.alt.length).toBeGreaterThan(10);
				expect(step.image.callouts.length).toBeGreaterThan(0);
				expect(step.image.callouts.length).toBeLessThanOrEqual(4);
				for (const pin of step.image.callouts) {
					expect(pin.x).toBeGreaterThanOrEqual(0);
					expect(pin.x).toBeLessThanOrEqual(100);
					expect(pin.y).toBeGreaterThanOrEqual(0);
					expect(pin.y).toBeLessThanOrEqual(100);
				}
			}
		}
	});
});
