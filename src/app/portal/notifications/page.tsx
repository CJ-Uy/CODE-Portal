import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { Bell, CheckCheck } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { formatUtc8Day, formatUtc8Time } from "@/lib/date-slots";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { markAllNotificationsReadAction } from "./actions";
import { NotificationRow } from "./notification-row";

export const dynamic = "force-dynamic";

function when(createdAt: number): string {
	const date = new Date(createdAt);
	const day = formatUtc8Day(date);
	return day === "Today" || day === "Yesterday" ? `${day}, ${formatUtc8Time(date)}` : day;
}

export default async function NotificationsPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("notifications")) notFound();

	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const repositories = await getRepositories();
	// notifications has no shared-dev internal proxy yet; degrade to an empty feed instead of crashing.
	const items = await repositories.notifications.listFeed(actor, { limit: 50 }).catch(() => []);
	const fresh = items.filter((item) => item.readAt === null);
	const earlier = items.filter((item) => item.readAt !== null);

	return (
		<div className="grid gap-5">
			<PageHeader
				title="Notifications"
				description={items.length ? (fresh.length ? `${fresh.length} new` : "You are all caught up.") : undefined}
				actions={
					fresh.length ? (
						<form action={markAllNotificationsReadAction}>
							<Button type="submit" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
								<CheckCheck />
								Mark all read
							</Button>
						</form>
					) : null
				}
			/>

			{items.length === 0 ? (
				<EmptyState icon={Bell} title="You are all caught up" description="Event invites, feedback requests and points will show up here." />
			) : (
				<div className="grid gap-5">
					{[
						{ title: "New", rows: fresh },
						{ title: "Earlier", rows: earlier },
					].map((group) =>
						group.rows.length ? (
							<section key={group.title} className="grid gap-2" aria-label={group.title}>
								<h2 className="font-sans! text-sm font-semibold text-muted-foreground">{group.title}</h2>
								<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
									{group.rows.map((item) => (
										<li key={item.id}>
											<NotificationRow item={item} when={when(item.createdAt)} />
										</li>
									))}
								</ul>
							</section>
						) : null,
					)}
				</div>
			)}
		</div>
	);
}
