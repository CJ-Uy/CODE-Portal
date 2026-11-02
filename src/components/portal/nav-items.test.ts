import { expect, it } from "vitest";
import type { FeatureFlags } from "@/server/features";
import { PORTAL_SECTIONS } from "@/server/links/redirect";
import { primaryNav, navGroups, sectionFor, visibleMobileNav, visiblePrimaryNav, visibleNavGroups } from "./nav-items";

it("keeps Calendar and Retention prominent and every visible destination reachable on mobile", () => {
	expect(primaryNav.map((item) => item.id)).toEqual(["overview", "calendar", "retention"]);
	for (let mask = 0; mask < 128; mask++) {
		const flags = Object.fromEntries(["retention", "ments", "email", "notifications", "library", "announcements", "gallery"].map((key, index) => [key, Boolean(mask & (1 << index))])) as FeatureFlags;
		const groups = visibleNavGroups(flags);
		expect(groups.every((group) => group.items.length > 0)).toBe(true);
		const desktop = [...visiblePrimaryNav(flags), ...groups.flatMap((group) => group.items)];
		const expected = [...primaryNav, ...navGroups.flatMap((group) => group.items)].filter((item) => !item.feature || flags[item.feature]);
		expect(desktop.map((item) => item.id)).toEqual(expected.map((item) => item.id));
		expect(new Set(desktop.map((item) => item.id)).size).toBe(desktop.length);
		const mobile = visibleMobileNav(flags);
		expect(mobile.map((item) => item.id)).toEqual(["overview", "calendar", flags.retention ? "retention" : "links", "profile"]);
		expect(mobile.map((item) => item.label)).toEqual(["Home", "Calendar", flags.retention ? "Retention" : "Link shortener", "Profile"]);
		const menu = desktop.filter((item) => !mobile.some((tab) => tab.id === item.id));
		expect([...mobile, ...menu].map((item) => item.id).sort()).toEqual(expected.map((item) => item.id).sort());
	}
});

it("lets every portal nav section be typed at the root, e.g. /guides", () => {
	const sections = [...primaryNav, ...navGroups.flatMap((group) => group.items)].map((item) => item.href.split("/")[2]).filter(Boolean);
	expect(sections.filter((section) => !PORTAL_SECTIONS.has(section))).toEqual([]);
});

it("names the section a page belongs to and links back from deeper pages", () => {
	expect(sectionFor("/portal")).toEqual({ label: "Home", href: "/portal", atRoot: true });
	expect(sectionFor("/portal/calendar?view=list")).toEqual({ label: "Calendar", href: "/portal/calendar", atRoot: true });
	expect(sectionFor("/portal/calendar/evt_1")).toEqual({ label: "Calendar", href: "/portal/calendar", atRoot: false });
	expect(sectionFor("/portal/important-links")).toMatchObject({ label: "Important links", atRoot: true });
	expect(sectionFor("/portal/links/lnk_1")).toMatchObject({ label: "Link shortener", atRoot: false });
	expect(sectionFor("/portal/mail/preferences/")).toMatchObject({ label: "Mail", atRoot: false });
	expect(sectionFor("/portal/surveys/srv_1")).toEqual({ label: "Home", href: "/portal", atRoot: false });
});
