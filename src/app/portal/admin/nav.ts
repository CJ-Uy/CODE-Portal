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
			description: "Add members and manage who can sign in to the portal.",
			permission: "roster:manage",
		},
		{ segment: "roles", label: "Roles & Access", description: "Grant admin roles to members.", permission: "role:assign" },
		{ segment: "ments", label: "Ments Tree", description: "Manage mentors, mentees, and their branches.", permission: "member:manage", feature: "ments" },
		{
			segment: "school-years",
			label: "School Years",
			description: "Set school year dates and retention point thresholds.",
			permission: "retention:configure",
			href: "/portal/admin/system/school-years",
		},
	]),
	G("content", "Content", [
		{ segment: "announcements", label: "Announcements", description: "Publish and schedule updates for members.", permission: "announcement:manage", feature: "announcements" },
		{ segment: "library", label: "Library", description: "Manage articles, case studies and resource access.", permission: "library:manage", feature: "library" },
		{ segment: "surveys", label: "Surveys", description: "Create questions and select survey participants.", permission: "survey:configure", feature: "surveys" },
		{
			segment: "submissions",
			label: "Public Submissions",
			description: "Review contact inquiries and article feedback.",
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
			description: "Manage sender addresses and member email preferences.",
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
	const clean = pathname.split(/[?#]/)[0].replace(/\/$/, "");
	if (clean === "/portal/admin") return [{ label: "Admin" }];
	const page = adminGroups.flatMap((group) => group.pages)
		.filter((page) => clean === page.href || clean.startsWith(`${page.href}/`))
		.sort((a, b) => b.href.length - a.href.length)[0];
	const memberDetail = !page && /^\/portal\/admin\/members\/[^/]+$/.test(clean);
	const group = memberDetail ? adminGroups[0] : adminGroups.find((group) => group.pages.includes(page)) ?? adminGroups.find((group) => clean === group.href);
	if (!group) return trail;
	const onGroupIndex = clean === group.href;
	trail.push({ label: group.label, href: onGroupIndex ? undefined : group.href });
	if (onGroupIndex) return trail;
	if (memberDetail) {
		trail.push({ label: "Member List", href: "/portal/admin/members/list" }, { label: "Member profile" });
	} else if (page) {
		// A group overview is already represented by its group breadcrumb.
		if (page.href !== group.href) trail.push({ label: page.label, href: clean === page.href ? undefined : page.href });
		if (clean !== page.href) {
			const remainder = clean.slice(page.href.length + 1);
			const detail = page.segment === "surveys" ? "Survey details"
				: page.segment === "events" ? "Event roster"
					: page.segment === "inbox" ? "Reply details"
						: page.segment === "templates" ? (remainder === "new" ? "New template" : "Edit template")
							: page.segment === "home" && remainder.startsWith("sends/") ? "Email details" : "Details";
			if (page.segment === "home" && /^sends\/[^/]+\/edit$/.test(remainder)) {
				trail.push({ label: "Email details", href: clean.replace(/\/edit$/, "") }, { label: "Edit email" });
			} else trail.push({ label: detail });
		}
	}
	return trail;
}

/**
 * Header {section, title} for an admin path, derived from the breadcrumb trail.
 * Returns null for non-admin paths so the caller can fall through to its own logic.
 */
export function adminHeading(pathname: string): { section: string; title: string } | null {
	const clean = pathname.split(/[?#]/)[0].replace(/\/$/, "");
	if (clean !== "/portal/admin" && !clean.startsWith("/portal/admin/")) return null;
	if (clean === "/portal/admin") return { section: "Admin", title: "Overview" };
	const trail = crumbFor(clean);
	if (trail.length < 2) return { section: "Admin", title: "Overview" };
	return { section: trail[trail.length - 2].label, title: trail[trail.length - 1].label };
}

