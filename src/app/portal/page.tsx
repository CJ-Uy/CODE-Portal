import { redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import Link from "next/link";
import { ArrowRight, BookOpen, MessageSquare, QrCode } from "lucide-react";
import { getRepositories } from "@/db";
import { EventScanPanel } from "@/components/event-scan-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RetentionProgress } from "@/components/portal/overview-metrics";
import { DateTile } from "@/components/portal/date-tile";
import { PageHeader } from "@/components/portal/page-header";
import { formatUtc8Day, formatUtc8Time, toLocalDate } from "@/lib/date-slots";
import { KIND_LABELS } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { getFeatureFlags } from "@/server/features";
import { CHECKIN_LEAD_MS } from "@/db/repositories/events";
import type { OverviewSummary } from "@/db/repositories/overview";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: OverviewSummary = {
	retention: { points: 0, retainedAt: null, termName: null },
	pendingSurveys: 0,
	oldestPendingSurveyId: null,
	upcomingEvents: 0,
	linkClicks: 0,
};

export default async function PortalOverviewPage() {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const flags = getFeatureFlags();
	const repositories = await getRepositories();
	// Each read degrades to an empty/zeroed value so the dashboard never crashes
	// when a repository is unavailable through the shared-dev adapter. Flagged-off
	// surfaces skip the read entirely rather than fetching rows nothing will render.
	const [summary, announcements, libraryItems, scanEvents, terms] = await Promise.all([
		repositories.overview.getSummary(actor).catch(() => EMPTY_SUMMARY),
		flags.announcements ? repositories.announcements.listForMember(actor, { limit: 3 }).catch(() => []) : Promise.resolve([]),
		flags.library
			? repositories.library
					.search(actor, { sort: "newest", limit: 3 })
					.then((result) => result.cards)
					.catch(() => [])
			: Promise.resolve([]),
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
	const todayIso = toLocalDate(now);
	const happeningToday = upcomingEvents.some((event) => toLocalDate(event.startsAt) <= todayIso);
	const pendingForms = flags.surveys && summary.oldestPendingSurveyId ? summary.pendingSurveys : 0;

	return (
		<div className="grid min-w-0 grid-cols-1 gap-6">
			<PageHeader title="Home" description={today} />

			{/* A member who signed in from a feedback email lands here, so the waiting form is the first thing they see. */}
			{pendingForms > 0 ? (
				<Link
					href={`/portal/surveys/${encodeURIComponent(summary.oldestPendingSurveyId!)}`}
					className="group flex min-w-0 items-center gap-3 rounded-xl bg-secondary px-4 py-3 text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<span className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-accent">
						<MessageSquare className="size-5" aria-hidden />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block font-semibold">
							{pendingForms === 1 ? "A feedback form is waiting for you" : `${pendingForms} feedback forms are waiting for you`}
						</span>
						<span className="block text-sm text-secondary-foreground/80">Answer while the event is fresh.</span>
					</span>
					<span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold">
						Answer
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
					</span>
				</Link>
			) : null}

			<div className={flags.retention ? "grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "grid min-w-0 grid-cols-1 gap-6"}>
				<section aria-labelledby="home-events" className="min-w-0 rounded-lg border bg-card shadow-sm">
					<div className="flex items-center justify-between gap-3 p-5 pb-2">
						<h2 id="home-events" className="text-base font-semibold">Upcoming events</h2>
						<SeeAll href="/portal/calendar">Calendar</SeeAll>
					</div>
					{upcomingEvents.length ? (
						<ul className="divide-y divide-border px-2 pb-2">
							{upcomingEvents.map((event) => {
								const isToday = toLocalDate(event.startsAt) <= todayIso;
								return (
									<li key={event.id}>
										<Link
											href={`/portal/calendar/${event.id}`}
											className="group flex min-w-0 items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<DateTile date={event.startsAt} today={isToday} />
											<span className="min-w-0 flex-1">
												<span className="block font-medium [overflow-wrap:anywhere] group-hover:underline">{event.title}</span>
												<span className="mt-0.5 block text-sm text-muted-foreground [overflow-wrap:anywhere]">
													{isToday ? "Today" : formatUtc8Day(event.startsAt, now)} · {formatUtc8Time(event.startsAt)}
													{event.place ? ` · ${event.place}` : ""}
												</span>
											</span>
											<ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										</Link>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="px-5 pb-5 pt-1 text-sm text-muted-foreground">Nothing coming up yet. Approved events show here and on Calendar.</p>
					)}
					{happeningToday ? (
						<div className="border-t border-border px-5 py-3">
							<Link
								href="/portal/profile?code=1#check-in"
								className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<QrCode className="size-4" aria-hidden />
								Show my check-in code
							</Link>
						</div>
					) : null}
				</section>
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

			{flags.announcements || flags.library ? (
				<div className={flags.library && flags.announcements ? "grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "grid min-w-0 grid-cols-1 gap-6"}>
					{flags.announcements ? (
						<section aria-labelledby="home-announcements" className="min-w-0 rounded-lg border bg-card shadow-sm">
							<div className="flex items-center justify-between gap-3 p-5 pb-2">
								<h2 id="home-announcements" className="text-base font-semibold">Announcements</h2>
								<SeeAll href="/portal/announcements">See all</SeeAll>
							</div>
							{announcements.length === 0 ? (
								<p className="px-5 pb-5 pt-1 text-sm text-muted-foreground">No announcements right now.</p>
							) : (
								<ul className="divide-y divide-border px-2 pb-2">
									{announcements.map((item) => (
										<li key={item.id}>
											<Link
												href={`/portal/announcements#${item.id}`}
												className="flex min-w-0 items-start gap-3 rounded-md px-3 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<span className={item.unread ? "mt-2 size-2 shrink-0 rounded-full bg-[#4986AC]" : "mt-2 size-2 shrink-0"} aria-hidden />
												<span className="min-w-0 flex-1">
													<span className="flex min-w-0 items-baseline justify-between gap-3">
														<span className={`min-w-0 text-sm [overflow-wrap:anywhere] ${item.unread ? "font-semibold" : "font-medium"}`}>{item.title}</span>
														<span className="shrink-0 text-xs text-muted-foreground">{formatUtc8Day(item.createdAt, now)}</span>
													</span>
													<span className="mt-0.5 line-clamp-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.body}</span>
													{item.unread ? <span className="sr-only">Unread.</span> : null}
												</span>
											</Link>
										</li>
									))}
								</ul>
							)}
						</section>
					) : null}
					{flags.library ? (
						<section aria-labelledby="home-library" className="min-w-0 rounded-lg border bg-card shadow-sm">
							<div className="flex items-center justify-between gap-3 p-5 pb-2">
								<h2 id="home-library" className="text-base font-semibold">New in the library</h2>
								<SeeAll href="/portal/library">Browse</SeeAll>
							</div>
							{libraryItems.length === 0 ? (
								<p className="px-5 pb-5 pt-1 text-sm text-muted-foreground">No library items yet.</p>
							) : (
								<ul className="divide-y divide-border px-2 pb-2">
									{libraryItems.map((item) => (
										<li key={item.id}>
											<Link
												href={`/portal/library/${item.id}`}
												className="flex min-w-0 items-start gap-3 rounded-md px-3 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<BookOpen className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
													<span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
														{[KIND_LABELS[item.kind], item.authorsJson.map((author) => author.name).join(", ")].filter(Boolean).join(" · ")}
													</span>
												</span>
											</Link>
										</li>
									))}
								</ul>
							)}
						</section>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<Link href={href} className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
			{children}
			<ArrowRight className="size-3.5" aria-hidden />
		</Link>
	);
}
