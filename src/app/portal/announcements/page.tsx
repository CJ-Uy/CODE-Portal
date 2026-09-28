import { notFound, redirect } from "next/navigation";
import { Check, Megaphone, Pin } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/portal/empty-state";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import type { AnnouncementFeedItem } from "@/db/repositories/announcements";
import { markAnnouncementReadAction } from "./actions";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
	return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

function AnnouncementCard({ item }: { item: AnnouncementFeedItem }) {
	const paragraphs = item.body.split(/\n{2,}/).filter(Boolean);
	return (
		<Card className={item.unread ? "border-accent/40 bg-secondary/30" : undefined}>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="info">{item.tag}</Badge>
					{item.pinned ? (
						<Badge variant="secondary" className="gap-1">
							<Pin className="size-3" />
							Pinned
						</Badge>
					) : null}
					{item.unread ? <span className="size-2 rounded-full bg-accent" aria-label="Unread" /> : null}
					<span className="ml-auto text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
				</div>
				<CardTitle className="text-xl">{item.title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{paragraphs.map((paragraph, index) => (
					<p key={index} className="text-sm leading-relaxed text-foreground/90">
						{paragraph}
					</p>
				))}
				{item.unread ? (
					<form action={markAnnouncementReadAction}>
						<input type="hidden" name="id" value={item.id} />
						<Button type="submit" variant="outline" size="sm">
							<Check />
							Mark read
						</Button>
					</form>
				) : null}
			</CardContent>
		</Card>
	);
}

export default async function AnnouncementsPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("announcements")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const items = await repositories.announcements.listForMember(actor, { limit: 50 }).catch(() => []);
	const pinned = items.filter((item) => item.pinned);
	const rest = items.filter((item) => !item.pinned);

	return (
		<div className="grid gap-5">
			<div>
				<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
				<h1 className="font-heading text-3xl">Announcements</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Org updates from CODE. Pinned posts stay at the top.
				</p>
			</div>

			{items.length === 0 ? (
				<EmptyState icon={Megaphone} title="No announcements yet" description="Check back soon for updates from CODE." />
			) : (
				<div className="grid gap-4">
					{pinned.map((item) => (
						<AnnouncementCard key={item.id} item={item} />
					))}
					{rest.map((item) => (
						<AnnouncementCard key={item.id} item={item} />
					))}
				</div>
			)}
		</div>
	);
}
