import { CalendarDays, CircleUserRound, House, Bell, BookOpen, Bookmark, Link2, Award, Megaphone, ShieldCheck, Mail, GitBranch, LifeBuoy, Images } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// Type-only, so no server module reaches the client bundle.
import type { FeatureFlags } from "@/server/features";
import { withFallback, withoutHidden } from "./nav-visibility";

export type NavItem = {
	id: string;
	label: string;
	href: string;
	icon: LucideIcon;
	/** Hidden unless this release flag is on. Unset means always visible. */
	feature?: keyof FeatureFlags;
};

// Keep participation a single click away, above the grouped destinations.
export const primaryNav: NavItem[] = [
	{ id: "overview", label: "Home", href: "/portal", icon: House },
	{ id: "calendar", label: "Calendar", href: "/portal/calendar", icon: CalendarDays },
	{ id: "retention", label: "Retention", href: "/portal/retention", icon: Award, feature: "retention" },
];

export const navGroups: { label: string; items: NavItem[] }[] = [
	{
		label: "Community",
		items: [
			{ id: "announcements", label: "Announcements", href: "/portal/announcements", icon: Megaphone, feature: "announcements" },
			{ id: "ments", label: "Ments Tree", href: "/portal/ments", icon: GitBranch, feature: "ments" },
			{ id: "gallery", label: "Gallery", href: "/portal/gallery", icon: Images, feature: "gallery" },
		],
	},
	{
		label: "Resources & tools",
		items: [
			{ id: "library", label: "Library", href: "/portal/library", icon: BookOpen, feature: "library" },
			{ id: "important-links", label: "Important links", href: "/portal/important-links", icon: Bookmark },
			{ id: "links", label: "Link shortener", href: "/portal/links", icon: Link2 },
			{ id: "guides", label: "Guides", href: "/portal/guides", icon: LifeBuoy },
		],
	},
	{
		label: "Personal",
		items: [
			{ id: "mail", label: "Mail", href: "/portal/mail", icon: Mail, feature: "email" },
			{ id: "notifications", label: "Notifications", href: "/portal/notifications", icon: Bell, feature: "notifications" },
			{ id: "profile", label: "Profile", href: "/portal/profile", icon: CircleUserRound },
		],
	},
];

const allNav = [...primaryNav, ...navGroups.flatMap((group) => group.items)];

// Admin entry is rendered only when the actor has at least one admin scope.
export const adminNav: NavItem = { id: "admin", label: "Admin", href: "/portal/admin", icon: ShieldCheck };

export function visiblePrimaryNav(flags: FeatureFlags): NavItem[] {
	return withoutHidden(primaryNav, new Set(), flags);
}

/** Four mobile slots. Links backfills Retention when its release flag is off. */
export function visibleMobileNav(flags: FeatureFlags): NavItem[] {
	return withFallback(
		allNav.filter((item) => ["overview", "calendar", "retention", "profile"].includes(item.id)),
		allNav.find((item) => item.id === "links"),
		flags,
	);
}

/**
 * The member section a path belongs to, for the desktop top bar. Pages carry their own h1 and, deeper down,
 * their own breadcrumbs, so the bar names only the section and links back to it from any page below it.
 * Pages outside the nav, such as a feedback form, fall back to Home.
 */
export function sectionFor(pathname: string): { label: string; href: string; atRoot: boolean } {
	const path = pathname.split("?")[0]!.replace(/(.)\/+$/, "$1");
	const section =
		allNav
			.filter((item) => item.href !== "/portal" && (path === item.href || path.startsWith(`${item.href}/`)))
			.sort((a, b) => b.href.length - a.href.length)[0] ?? primaryNav[0]!;
	return { label: section.label, href: section.href, atRoot: path === section.href };
}

export function visibleNavGroups(flags: FeatureFlags) {
	return navGroups
		.map((group) => ({ ...group, items: withoutHidden(group.items, new Set(), flags) }))
		.filter((group) => group.items.length > 0);
}
