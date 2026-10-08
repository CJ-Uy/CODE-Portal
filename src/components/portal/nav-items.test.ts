import { expect, it } from "vitest";
import type { FeatureFlags } from "@/server/features";
import { primaryNav, secondaryNav, visibleMobileNav, visiblePrimaryNav, visibleSecondaryNav } from "./nav-items";

it("keeps released tools above Profile and every visible destination reachable on mobile", () => {
	expect(primaryNav.map((item) => item.id)).toEqual(["overview", "calendar", "retention", "ments", "links", "mail", "notifications", "profile"]);
	for (let mask = 0; mask < 64; mask++) {
		const flags = Object.fromEntries(["retention", "ments", "email", "notifications", "library", "announcements"].map((key, index) => [key, Boolean(mask & (1 << index))])) as FeatureFlags;
		const desktop = [...visiblePrimaryNav(flags), ...visibleSecondaryNav(flags)];
		const expected = [...primaryNav, ...secondaryNav].filter((item) => !item.feature || flags[item.feature]);
		expect(desktop.map((item) => item.id)).toEqual(expected.map((item) => item.id));
		const mobile = visibleMobileNav(flags);
		expect(mobile.map((item) => item.id)).toEqual(["overview", "calendar", flags.retention ? "retention" : "links", "profile"]);
		expect(mobile.map((item) => item.label)).toEqual(["Home", "Calendar", flags.retention ? "Retention" : "Link shortener", "Profile"]);
		const menu = desktop.filter((item) => !mobile.some((tab) => tab.id === item.id));
		expect([...mobile, ...menu].map((item) => item.id).sort()).toEqual(expected.map((item) => item.id).sort());
	}
});
