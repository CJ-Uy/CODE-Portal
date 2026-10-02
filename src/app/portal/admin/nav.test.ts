import { describe, it, expect } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { FeatureFlags } from "@/server/features";
import { adminGroups, visibleGroups, crumbFor, adminHeading } from "./nav";

const superActor: Actor = { memberId: "m1", roles: ["super"] };
const linkOnly: Actor = { memberId: "m2", roles: ["link"] };
const retentionActor: Actor = { memberId: "m3", roles: ["retention"] };
const allFlags: FeatureFlags = {
	retention: true,
	library: true,
	announcements: true,
	notifications: true,
	surveys: true,
	publicSite: true,
	leaderboard: true,
	email: true,
};

describe("admin nav registry", () => {
	it("has 4 groups with the spec's routes", () => {
		expect(adminGroups.map((g) => g.segment)).toEqual(["members", "content", "data", "system"]);
		const members = adminGroups.find((g) => g.segment === "members")!;
		expect(members.pages.map((p) => p.href)).toEqual([
			"/portal/admin/members/list",
			"/portal/admin/members/roles",
			"/portal/admin/system/school-years",
		]);
		const eventsAndPoints = adminGroups.find((g) => g.segment === "data")!;
		expect(eventsAndPoints.label).toBe("Events & Points");
		expect(eventsAndPoints.pages.map((p) => p.segment)).toEqual([
			"dashboard",
			"events",
			"members",
			"scans",
			"ledger",
			"event-types",
			"point-types",
			"exports",
		]);
	});

	it("gates the new events and points pages on retention:record", () => {
		const group = adminGroups.find((g) => g.segment === "data");
		for (const segment of ["events", "members", "scans", "ledger"]) {
			expect(group?.pages.find((page) => page.segment === segment)?.permission).toBe("retention:record");
		}
	});

	it("super sees every group; link role sees only Short Links + always-visible pages", () => {
		expect(visibleGroups(superActor, allFlags).length).toBe(4);
		const visible = visibleGroups(linkOnly, allFlags).flatMap((g) => g.pages.map((p) => p.href));
		expect(visible).toContain("/portal/admin/content/links");
		expect(visible).toContain("/portal/admin/system/audit"); // permission null means always visible
		expect(visible).not.toContain("/portal/admin/members/roles");
	});

	it("shows Point Types only to retention configuration holders", () => {
		const retentionPages = visibleGroups(retentionActor, allFlags).flatMap((group) => group.pages.map((page) => page.href));
		const linkPages = visibleGroups(linkOnly, allFlags).flatMap((group) => group.pages.map((page) => page.href));
		expect(retentionPages).toContain("/portal/admin/system/point-types");
		expect(linkPages).not.toContain("/portal/admin/system/point-types");
		expect(crumbFor("/portal/admin/system/point-types")).toEqual([
			{ label: "Admin", href: "/portal/admin" },
			{ label: "Events & Points", href: "/portal/admin/data" },
			{ label: "Point Types" },
		]);
	});

	it("files School Years under Members & Access and gates it on retention configuration", () => {
		expect(crumbFor("/portal/admin/system/school-years")).toEqual([
			{ label: "Admin", href: "/portal/admin" },
			{ label: "Members & Access", href: "/portal/admin/members" },
			{ label: "School Years" },
		]);
		expect(visibleGroups(retentionActor, allFlags).flatMap((g) => g.pages.map((p) => p.href))).toContain(
			"/portal/admin/system/school-years",
		);
		expect(visibleGroups(linkOnly, allFlags).flatMap((g) => g.pages.map((p) => p.href))).not.toContain(
			"/portal/admin/system/school-years",
		);
	});

	it("hides disabled content surfaces even from super admins", () => {
		const disabled: FeatureFlags = { ...allFlags, library: false, announcements: false, surveys: false, publicSite: false };
		const visible = visibleGroups(superActor, disabled).flatMap((group) => group.pages.map((page) => page.href));
		for (const route of ["announcements", "library", "surveys", "submissions"]) {
			expect(visible).not.toContain(`/portal/admin/content/${route}`);
		}
		expect(visible).toContain("/portal/admin/content/links");
	});

	it("builds a breadcrumb trail with clickable ancestors", () => {
		expect(crumbFor("/portal/admin/members/roles")).toEqual([
			{ label: "Admin", href: "/portal/admin" },
			{ label: "Members & Access", href: "/portal/admin/members" },
			{ label: "Roles & Access" },
		]);
	});

	it("marks the current page (leaf) without an href and keeps ancestors clickable on a group index", () => {
		expect(crumbFor("/portal/admin/members")).toEqual([
			{ label: "Admin", href: "/portal/admin" },
			{ label: "Members & Access" },
		]);
	});

	it("adminHeading resolves section+title at each depth and ignores non-admin paths", () => {
		expect(adminHeading("/portal/admin")).toEqual({ section: "Admin", title: "Console" });
		expect(adminHeading("/portal/admin/members")).toEqual({ section: "Admin", title: "Members & Access" });
		expect(adminHeading("/portal/admin/members/roles")).toEqual({ section: "Members & Access", title: "Roles & Access" });
		expect(adminHeading("/portal/library")).toBeNull();
	});
});


