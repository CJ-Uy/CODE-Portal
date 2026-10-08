import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, ClipboardCheck, Link2, Megaphone, MessageSquare } from "lucide-react";
import { getRepositories } from "@/db";
import { EventScanPanel } from "@/components/event-scan-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, RetentionProgress } from "@/components/portal/overview-metrics";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { getFeatureFlags } from "@/server/features";
import { CHECKIN_LEAD_MS } from "@/db/repositories/events";
import type { OverviewSummary } from "@/db/repositories/overview";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: OverviewSummary = {
	retention: { points: 0, retainedAt: null, termName: null },
	pendingSurveys: 0,
	upcomingEvents: 0,
	linkClicks: 0,
};

export default async function PortalOverviewPage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const flags = getFeatureFlags();
	const repositories = await getRepositories();
	// Each read degrades to an empty/zeroed value so the dashboard never crashes
	// when a repository is unavailable through the shared-dev adapter. Flagged-off
	// surfaces skip the read entirely rather than fetching rows nothing will render.
	const [summary, announcements, libraryItems, scanEvents, terms] = await Promise.all([
		repositories.overview.getSummary(actor).catch(() => EMPTY_SUMMARY),
		flags.announcements ? repositories.announcements.listForMember(actor, { limit: 3 }).catch(() => []) : Promise.resolve([]),
		flags.library ? repositories.library.listItems(actor, { limit: 3 }).catch(() => []) : Promise.resolve([]),
		repositories.events.listPublished(actor, { limit: 100 }).catch(() => []),
		repositories.retention.listTerms(actor).catch(() => []),
	]);
	const now = new Date();
	const liveScanEvents = scanEvents.filter(
		(event) =>
			event.myRole === "scanner" &&
			event.endsAt !== null &&
			now.getTime() >= event.startsAt.getTime() - CHECKIN_LEAD_MS &&
			now.getTime() <= event.endsAt.getTime(),
	);
	const currentTerm = terms.find((term) => term.isCurrent);
	const canUndoScans = getAppConfig().APP_ENV !== "shared";

	const upcomingEvents = scanEvents.filter((event) => event.status === "approved" && (event.endsAt ?? event.startsAt) >= now).slice(0, 3);
	if (scanEvents.length === 100) {
		for (let offset = 100; upcomingEvents.length < 3; offset += 100) {
			const page = await repositories.events.listPublished(actor, { limit: 100, offset }).catch(() => []);
			upcomingEvents.push(...page.filter((event) => event.status === "approved" && (event.endsAt ?? event.startsAt) >= now).slice(0, 3 - upcomingEvents.length));
			if (page.length < 100) break;
		}
	}
	const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" }).format(now);
	const eventDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

	return (
		<div className="grid min-w-0 grid-cols-1 gap-6">
			<div>
				<h1 className="font-heading text-3xl">Home</h1>
				<p className="mt-1 text-sm text-muted-foreground">{today}</p>
			</div>

			<div className={flags.retention ? "grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "grid min-w-0 grid-cols-1 gap-6"}>
				<Card>
					<CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
						<CardTitle>Upcoming events</CardTitle>
						<Button asChild variant="outline" size="sm"><Link href="/portal/calendar"><CalendarDays />Calendar</Link></Button>
					</CardHeader>
					<CardContent>
						{upcomingEvents.length ? <ul className="divide-y divide-border">
							{upcomingEvents.map((event) => <li key={event.id}>
								<Link href={`/portal/calendar/${event.id}`} className="group flex min-w-0 items-center gap-4 rounded-md py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
									<div className="min-w-0 flex-1">
										<p className="break-words font-medium group-hover:underline">{event.title}</p>
										<p className="mt-1 text-sm text-muted-foreground">{eventDate.format(event.startsAt)}{event.place ? ` · ${event.place}` : ""}</p>
									</div>
									<ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</Link>
							</li>)}
						</ul> : <p className="text-sm text-muted-foreground">No upcoming events scheduled. Check Calendar for updates.</p>}
					</CardContent>
				</Card>
				{flags.retention ? (
					<Card>
						<CardHeader>
							<CardTitle>Retention path</CardTitle>
							<CardDescription>{summary.retention.termName ?? "Current term"}</CardDescription>
						</CardHeader>
						<CardContent>
							<RetentionProgress points={summary.retention.points} retainedAt={summary.retention.retainedAt} />
						</CardContent>
					</Card>
				) : null}
			</div>

			{currentTerm
				? liveScanEvents.map((event) => (
					<EventScanPanel
						key={event.id}
						eventId={event.id}
						eventTitle={event.title}
						termId={currentTerm.id}
						closesAt={event.endsAt!}
						scannedCount={event.scannedCount}
						canUndo={canUndoScans}
					/>
				))
				: null}

			{/* Metrics for flagged-off surfaces drop out rather than showing a zero the member
			    cannot act on. The grid reflows on its own at two or three cards. */}
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{flags.retention ? (
					<MetricCard
						label="Retention"
						value={summary.retention.termName ? String(summary.retention.points) : "0"}
						description={summary.retention.termName ?? "No active term"}
						icon={ClipboardCheck}
					/>
				) : null}
				{flags.surveys ? (
					<MetricCard label="Surveys" value={String(summary.pendingSurveys)} description="Pending responses" icon={MessageSquare} />
				) : null}
				<MetricCard label="Events" value={String(summary.upcomingEvents)} description="Upcoming approved events" icon={CalendarDays} />
				<MetricCard label="Links" value={String(summary.linkClicks)} description="Clicks on your short links" icon={Link2} />
			</div>

			<div className={flags.library && flags.announcements ? "grid gap-6 lg:grid-cols-[1.4fr_1fr]" : "grid gap-6"}>
					{flags.announcements ? (
					<Card>
						<CardHeader className="flex-row items-center justify-between space-y-0">
							<div className="flex items-center gap-2">
								<Megaphone className="size-4 text-accent" />
								<CardTitle className="text-lg">Announcements</CardTitle>
							</div>
							<Link href="/portal/announcements" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
								See all
								<ArrowRight className="size-3.5" />
							</Link>
						</CardHeader>
						<CardContent className="grid gap-3">
							{announcements.length === 0 ? (
								<p className="text-sm text-muted-foreground">No announcements right now.</p>
							) : (
								announcements.map((item) => (
									<div key={item.id} className="flex items-start gap-3">
										<Badge variant="info" className="mt-0.5 shrink-0">
											{item.tag}
										</Badge>
										<div className="min-w-0">
											<p className="truncate text-sm font-medium">{item.title}</p>
											<p className="line-clamp-1 text-xs text-muted-foreground">{item.body}</p>
										</div>
										{item.unread ? <span className="ml-auto mt-1.5 size-2 shrink-0 rounded-full bg-accent" /> : null}
									</div>
								))
							)}
						</CardContent>
					</Card>
					) : null}
				{flags.library ? (
				<Card>
					<CardHeader className="flex-row items-center justify-between space-y-0">
						<div className="flex items-center gap-2">
							<BookOpen className="size-4 text-accent" />
							<CardTitle className="text-lg">From the library</CardTitle>
						</div>
						<Link href="/portal/library" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
							Browse
							<ArrowRight className="size-3.5" />
						</Link>
					</CardHeader>
					<CardContent className="grid gap-3">
						{libraryItems.length === 0 ? (
							<p className="text-sm text-muted-foreground">No library items yet.</p>
						) : (
							libraryItems.map((item) => (
								<Link
									key={item.id}
									href={`/portal/library/${item.id}`}
									className="group grid gap-1 rounded-lg border border-border p-3 transition-colors hover:border-accent"
								>
									<span className="text-xs text-muted-foreground">{item.category}</span>
									<span className="text-sm font-medium leading-snug group-hover:text-accent">{item.title}</span>
								</Link>
							))
						)}
					</CardContent>
				</Card>
				) : null}
			</div>
		</div>
	);
}
