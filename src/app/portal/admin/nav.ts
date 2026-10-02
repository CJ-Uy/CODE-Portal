import type { Actor, PermissionAction } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { FeatureFlags, FeatureKey } from "@/server/features";

export type AdminPermission = PermissionAction | null;
export type AdminPage = {
	segment: string;
	label: string;
	href: string;
	description: string;
	permission: AdminPermission;
	feature?: FeatureKey;
};
export type AdminGroup = { segment: string; label: string; href: string; pages: AdminPage[] };

const G = (segment: string, label: string, pages: (Omit<AdminPage, "href"> & { href?: string })[]): AdminGroup => ({
	segment,
	label,
	href: `/portal/admin/${segment}`,
	pages: pages.map((p) => ({ ...p, href: p.href ?? `/portal/admin/${segment}/${p.segment}` })),
});

export const adminGroups: AdminGroup[] = [
	G("members", "Members & Access", [
		{
			segment: "list",
			label: "Member List",
			description: "Official CODE members this term; adding an email lets that person sign in.",
			permission: "roster:manage",
		},
		{ segment: "roles", label: "Roles & Access", description: "Grant admin roles to members.", permission: "role:assign" },
		{
			segment: "school-years",
			label: "School Years",
			description: "Set each school year's span and point thresholds; check-ins need one covering today.",
			permission: "retention:configure",
			href: "/portal/admin/system/school-years",
		},
	]),
	G("content", "Content", [
		{ segment: "announcements", label: "Announcements", description: "Org posts.", permission: "announcement:manage", feature: "announcements" },
		{ segment: "library", label: "Library", description: "Articles & case studies.", permission: "library:manage", feature: "library" },
		{ segment: "surveys", label: "Surveys", description: "Sampling & questions.", permission: "survey:configure", feature: "surveys" },
		{
			segment: "submissions",
			label: "Public Submissions",
			description: "Contact inquiries + article feedback from the public site.",
			permission: null,
			feature: "publicSite",
		},
		{ segment: "links", label: "Short Links", description: "Moderate member short links.", permission: "link:moderate" },
	]),
	G("email", "Email", [
		{
			segment: "home",
			label: "Overview",
			description: "Sends in progress, scheduled emails, and recent sends.",
			permission: "email:send",
			feature: "email",
			href: "/portal/admin/email",
		},
		{ segment: "new", label: "New email", description: "Write an email and send it to members.", permission: "email:send", feature: "email" },
		{ segment: "inbox", label: "Replies", description: "Member replies to CODE emails.", permission: "email:send", feature: "email" },
		{ segment: "templates", label: "Templates", description: "Reusable CODE email designs.", permission: "email:configure", feature: "email" },
		{
			segment: "settings",
			label: "Senders & categories",
			description: "From addresses, and which emails members can turn off.",
			permission: "email:configure",
			feature: "email",
		},
	]),
	G("data", "Events & Points", [
		{
			segment: "dashboard",
			label: "Dashboard",
			description: "What needs your attention this term.",
			permission: "retention:record",
			href: "/portal/admin/data",
		},
		{
			segment: "events",
			label: "Events",
			description: "How each event turned out.",
			permission: "retention:record",
		},
		{
			segment: "members",
			label: "Members",
			description: "Attendance and points per member.",
			permission: "retention:record",
		},
		{
			segment: "scans",
			label: "Scan Log",
			description: "Every check-in and reversal, and who did it.",
			permission: "retention:record",
		},
		{
			segment: "ledger",
			label: "Ledger",
			description: "Every point record this school year.",
			permission: "retention:record",
		},
		{
			segment: "event-types",
			label: "Event Type Rules",
			description: "Which permission each event type requires to create.",
			permission: "role:assign",
			href: "/portal/admin/system/event-types",
		},
		{
			segment: "point-types",
			label: "Point Types",
			description: "Manage point labels, availability, and display order.",
			permission: "retention:configure",
			href: "/portal/admin/system/point-types",
		},
		{ segment: "exports", label: "Data Exports", description: "XLSX exports of points data.", permission: "retention:record" },
	]),
	G("system", "System", [
		{ segment: "nav-pins", label: "Pinned Nav Links", description: "Links shown in every member's top nav.", permission: "nav:configure" },
		{
			segment: "quick-links",
			label: "Dashboard Shortcuts",
			description: "Resources in the dashboard Quick Links widget.",
			permission: "nav:configure",
		},
		{ segment: "audit", label: "Activity Log", description: "Recorded admin actions.", permission: null },
	]),
];

const pageVisible = (actor: Actor, p: AdminPage, flags: FeatureFlags) =>
	(!p.feature || flags[p.feature]) && (p.permission === null || can(actor, p.permission));

export function visibleGroups(actor: Actor, flags: FeatureFlags): AdminGroup[] {
	return adminGroups
		.map((g) => ({ ...g, pages: g.pages.filter((p) => pageVisible(actor, p, flags)) }))
		.filter((g) => g.pages.length > 0);
}

export function crumbFor(pathname: string): { label: string; href?: string }[] {
	const trail: { label: string; href?: string }[] = [{ label: "Admin", href: "/portal/admin" }];
	const clean = pathname.split("?")[0] ?? "";
	const group =
		adminGroups.find((g) => g.pages.some((p) => clean === p.href || clean.startsWith(`${p.href}/`))) ??
		adminGroups.find((g) => clean === g.href);
	if (!group) return trail;
	const onGroupIndex = clean === group.href;
	trail.push({ label: group.label, href: onGroupIndex ? undefined : group.href });
	if (onGroupIndex) return trail;
	const page = group.pages.find((p) => clean === p.href || clean.startsWith(`${p.href}/`));
	if (page) trail.push({ label: page.label, href: clean === page.href ? undefined : page.href });
	return trail;
}

/**
 * Header {section, title} for an admin path, derived from the breadcrumb trail.
 * Returns null for non-admin paths so the caller can fall through to its own logic.
 */
export function adminHeading(pathname: string): { section: string; title: string } | null {
	const clean = pathname.split("?")[0] ?? "";
	if (!clean.startsWith("/portal/admin")) return null;
	if (clean === "/portal/admin") return { section: "Admin", title: "Console" };
	const trail = crumbFor(clean);
	if (trail.length < 2) return { section: "Admin", title: "Console" };
	return { section: trail[trail.length - 2].label, title: trail[trail.length - 1].label };
}

