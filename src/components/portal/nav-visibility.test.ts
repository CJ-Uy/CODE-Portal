import { describe, expect, it } from "vitest";
import { withFallback, withoutHidden, type FeatureGated } from "./nav-visibility";
import type { FeatureFlags } from "@/server/features";

const ALL_ON: FeatureFlags = {
	retention: true,
	library: true,
	announcements: true,
	notifications: true,
	surveys: true,
	publicSite: true,
	leaderboard: true,
};

// Mirrors the real nav shape without pulling lucide icons into the Workers pool.
const PRIMARY: FeatureGated[] = [
	{ id: "overview" },
	{ id: "calendar" },
	{ id: "retention", feature: "retention" },
	{ id: "profile" },
];
const SECONDARY: FeatureGated[] = [
	{ id: "library", feature: "library" },
	{ id: "announcements", feature: "announcements" },
	{ id: "links" },
	{ id: "notifications", feature: "notifications" },
];
const LINKS = SECONDARY[2];

function ids(items: FeatureGated[]): string[] {
	return items.map((item) => item.id);
}

describe("portal nav visibility", () => {
	it("keeps every entry when the flags are on", () => {
		expect(ids(withFallback(PRIMARY, LINKS, ALL_ON))).toEqual(["overview", "calendar", "retention", "profile"]);
		expect(ids(withoutHidden(SECONDARY, new Set(["overview", "calendar", "retention", "profile"]), ALL_ON))).toEqual([
			"library",
			"announcements",
			"links",
			"notifications",
		]);
	});

	it("holds the primary list at four slots when one is flagged off", () => {
		const flags = { ...ALL_ON, retention: false };
		const primary = withFallback(PRIMARY, LINKS, flags);
		expect(primary).toHaveLength(PRIMARY.length);
		expect(ids(primary)).toEqual(["overview", "calendar", "links", "profile"]);
	});

	it("does not list a backfilled entry twice", () => {
		const flags = { ...ALL_ON, retention: false };
		const primary = withFallback(PRIMARY, LINKS, flags);
		const secondary = withoutHidden(SECONDARY, new Set(ids(primary)), flags);
		expect(ids(secondary)).not.toContain("links");
		const all = [...ids(primary), ...ids(secondary)];
		expect(new Set(all).size).toBe(all.length);
	});

	it("hides flagged destinations and keeps unflagged ones", () => {
		const off: FeatureFlags = {
			retention: false,
			library: false,
			announcements: false,
			notifications: false,
			surveys: false,
			publicSite: false,
			leaderboard: false,
		};
		const primary = withFallback(PRIMARY, LINKS, off);
		expect(ids(primary)).not.toContain("retention");
		expect(ids(primary)).toEqual(["overview", "calendar", "links", "profile"]);
		expect(ids(withoutHidden(SECONDARY, new Set(ids(primary)), off))).toEqual([]);
	});

	it("leaves the item in place when no fallback exists", () => {
		const primary = withFallback(PRIMARY, undefined, { ...ALL_ON, retention: false });
		expect(ids(primary)).toEqual(["overview", "calendar", "retention", "profile"]);
	});
});
