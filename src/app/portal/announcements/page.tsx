import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { Check, Megaphone, Pin } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { cn } from "@/lib/utils";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import type { AnnouncementFeedItem } from "@/db/repositories/announcements";
import { markAnnouncementReadAction } from "./actions";

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

function AnnouncementCard({ item }: { item: AnnouncementFeedItem }) {
	const paragraphs = item.body.split(/\n{2,}/).filter(Boolean);
	return (
		// The id lets Home link straight to one announcement; scroll-mt clears the sticky top bar.
		<article id={item.id} className={cn("min-w-0 scroll-mt-24 rounded-xl border bg-card p-5 shadow-sm", item.unread && "border-[#4986AC]!")}>
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
				{item.pinned ? (
					<span className="inline-flex items-center gap-1 font-semibold text-accent">
						<Pin className="size-3" aria-hidden />
						Pinned
						<span className="font-normal text-muted-foreground" aria-hidden>·</span>
					</span>
				) : null}
				<span className="font-semibold text-foreground/80">{item.tag}</span>
				<span aria-hidden>·</span>
				<span>{DATE.format(item.createdAt)}</span>
				{item.unread ? (
					<span className="inline-flex items-center gap-1.5 font-semibold text-accent">
						<span className="size-2 rounded-full bg-[#4986AC]" aria-hidden />
						New
					</span>
				) : null}
			</p>
			<h2 className="mt-2 font-heading text-xl leading-snug [overflow-wrap:anywhere]">{item.title}</h2>
			<div className="mt-3 grid max-w-prose gap-3">
				{paragraphs.map((paragraph, index) => (
					<p key={index} className="text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
						{paragraph}
					</p>
				))}
			</div>
			{item.unread ? (
				<form action={markAnnouncementReadAction} className="mt-4">
					<input type="hidden" name="id" value={item.id} />
					<Button type="submit" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
						<Check />
						Mark read
					</Button>
				</form>
			) : null}
		</article>
	);
}

export default async function AnnouncementsPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("announcements")) notFound();

	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const repositories = await getRepositories();
	const items = await repositories.announcements.listForMember(actor, { limit: 50 }).catch(() => []);
	const pinned = items.filter((item) => item.pinned);
	const rest = items.filter((item) => !item.pinned);

	return (
		<div className="grid gap-5">
			<PageHeader title="Announcements" description="News from the officers. Pinned posts stay at the top." />

			{items.length === 0 ? (
				<EmptyState icon={Megaphone} title="No announcements yet" description="Check back soon for updates from CODE." />
			) : (
				<div className="grid max-w-3xl gap-4">
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
