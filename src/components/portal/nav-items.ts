import { CalendarDays, CircleUserRound, House, Bell, BookOpen, Link2, Award, Megaphone, ShieldCheck } from "lucide-react";
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

// Fixed core slots shown in the mobile bottom bar, split 2 + raised FAB + 2.
// Keep this at exactly four so the bar stays symmetric around the center FAB.
export const primaryNav: NavItem[] = [
	{ id: "overview", label: "Overview", href: "/portal", icon: House },
	{ id: "calendar", label: "Calendar", href: "/portal/calendar", icon: CalendarDays },
	// /portal/events currently renders the member retention-history page.
	{ id: "retention", label: "Retention", href: "/portal/events", icon: Award, feature: "retention" },
	{ id: "profile", label: "Profile", href: "/portal/profile", icon: CircleUserRound },
];

// Links that live inside the desktop sidebar and the mobile "More" sheet, not the
// fixed bar. Later phases append their destinations here (Library, Announcements)
// so the shell component never needs to change to gain a nav entry.
export const secondaryNav: NavItem[] = [
	{ id: "library", label: "Library", href: "/portal/library", icon: BookOpen, feature: "library" },
	{ id: "announcements", label: "Announcements", href: "/portal/announcements", icon: Megaphone, feature: "announcements" },
	{ id: "links", label: "Link shortener", href: "/portal/links", icon: Link2 },
	{ id: "notifications", label: "Notifications", href: "/portal/notifications", icon: Bell, feature: "notifications" },
];

// Admin entry is rendered only when the actor has at least one admin scope.
export const adminNav: NavItem = { id: "admin", label: "Admin", href: "/portal/admin", icon: ShieldCheck };

/** Link shortener is never flagged, so it backfills a hidden slot in the mobile bar. */
export function visiblePrimaryNav(flags: FeatureFlags): NavItem[] {
	return withFallback(
		primaryNav,
		secondaryNav.find((item) => item.id === "links"),
		flags,
	);
}

export function visibleSecondaryNav(flags: FeatureFlags): NavItem[] {
	const promoted = new Set(visiblePrimaryNav(flags).map((item) => item.id));
	return withoutHidden(secondaryNav, promoted, flags);
}
