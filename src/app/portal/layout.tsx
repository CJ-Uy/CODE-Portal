import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { NotificationBell } from "@/components/portal/notification-bell";
import { PortalShell } from "@/components/portal/portal-shell";
import { getActor } from "@/server/auth/actor";
import { hasAnyAdminScope } from "@/server/auth/admin";
import { getFeatureFlags } from "@/server/features";
import { visibleGroups } from "./admin/nav";
import { signOutAction } from "./actions";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./notifications/actions";

export const dynamic = "force-dynamic";

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const flags = getFeatureFlags();
	// notifications is unavailable through the shared-dev adapter until a future
	// phase wires an internal proxy route for it; degrade to an empty feed
	// instead of crashing every authed page.
	const [member, feed, unreadCount, navPins] = await Promise.all([
		repositories.members.getById(actor, actor.memberId),
		flags.notifications ? repositories.notifications.listFeed(actor, { limit: 10 }).catch(() => []) : Promise.resolve([]),
		flags.notifications ? repositories.notifications.unreadCount(actor).catch(() => 0) : Promise.resolve(0),
		repositories.navPins.listVisible(actor).catch(() => []),
	]);
	if (!member) redirect("/signin");

	const displayName = member.nickname ?? member.fullName ?? member.name ?? member.email;
	const showAdmin = hasAnyAdminScope(actor);
	const adminGroups = showAdmin
		? visibleGroups(actor, flags).map((group) => ({
				segment: group.segment,
				label: group.label,
				href: group.href,
				pages: group.pages.map((page) => ({ href: page.href, label: page.label })),
			}))
		: [];

	return (
		<>
			<PortalShell
				member={{ displayName, initials: initialsFrom(displayName), subtitle: member.email }}
				memberId={actor.memberId}
				navPins={navPins}
				showAdmin={showAdmin}
				adminGroups={adminGroups}
				flags={flags}
				signOutAction={signOutAction}
				bell={
					// The bell is the notifications surface in miniature, so it follows the same flag.
					flags.notifications ? (
						<NotificationBell
							items={feed}
							unreadCount={unreadCount}
							onMarkRead={markNotificationReadAction}
							onMarkAllRead={markAllNotificationsReadAction}
						/>
					) : null
				}
			>
				{children}
			</PortalShell>
		</>
	);
}
