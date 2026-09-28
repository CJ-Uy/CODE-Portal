import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/portal/empty-state";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { markAllNotificationsReadAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("notifications")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	// notifications has no shared-dev internal proxy yet; degrade to an empty feed instead of crashing.
	const items = await repositories.notifications.listFeed(actor, { limit: 50 }).catch(() => []);

	return (
		<div className="grid gap-5">
			<div className="flex items-end justify-between gap-4">
				<div>
					<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
					<h1 className="font-heading text-3xl">Notifications</h1>
				</div>
				<form action={markAllNotificationsReadAction}>
					<Button type="submit" variant="outline" size="sm">
						<CheckCheck />
						Mark all read
					</Button>
				</form>
			</div>

			{items.length === 0 ? (
				<EmptyState icon={Bell} title="You are all caught up" description="New notifications will show up here." />
			) : (
				<div className="grid gap-3">
					{items.map((item) => {
						const content = (
							<Card className={item.readAt === null ? "border-accent/40 bg-secondary/40 transition-colors" : "transition-colors"}>
								<CardHeader>
									<div className="flex items-center justify-between gap-3">
										<CardTitle className="text-base">{item.title}</CardTitle>
										{item.readAt === null ? <span className="size-2 shrink-0 rounded-full bg-accent" /> : null}
									</div>
									<CardDescription>{item.body}</CardDescription>
								</CardHeader>
							</Card>
						);
						return item.href ? (
							<Link key={item.id} href={item.href} className="block">
								{content}
							</Link>
						) : (
							<div key={item.id}>{content}</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
