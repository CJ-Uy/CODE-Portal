import { Suspense } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import { getRepositories } from "@/db";
import { allowedEventTypes } from "@/db/repositories/eventTypeRules";
import { Button } from "@/components/ui/button";
import { CalendarMonth } from "@/components/calendar-month";
import { loadEventTypes } from "@/lib/event-type-load";
import { utc8Parts } from "@/lib/date-slots";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { CreateEventSheet } from "./create-event-sheet";
import { CreateEventSkeleton, EventsListSkeleton, MonthGridSkeleton } from "./calendar-skeletons";
import { EventsList } from "./events-list";
import { loadEventList } from "./load-events";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/**
 * The page body awaits nothing. Every database read lives inside a Suspense boundary, so
 * the heading, the view tabs and the month controls paint on the first frame and a tab or
 * arrow responds immediately instead of waiting on a round trip.
 *
 * The boundary is keyed on view, year and month. Without the key React keeps the existing
 * boundary mounted and holds the previous month on screen until the new one arrives, which
 * reads as a dead click.
 */
export default async function CalendarPage({
	searchParams,
}: {
	searchParams: Promise<{ year?: string; month?: string; view?: string }>;
}) {
	const params = await searchParams;
	const view = params.view === "list" ? "list" : "calendar";
	// Points overlay only exists where the points surface itself is enabled.
	const showPoints = isFeatureEnabled("retention");
	const today = utc8Parts(new Date());
	const year = Number(params.year) || today.year;
	const month = Number(params.month) || today.month;

	const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
	const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

	const viewTabs = [
		{ id: "calendar", label: "Calendar", icon: CalendarDays, href: "/portal/calendar" },
		{ id: "list", label: "List", icon: List, href: "/portal/calendar?view=list" },
	];

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
					<h1 className="font-heading text-3xl">Calendar</h1>
				</div>
				<Suspense fallback={<CreateEventSkeleton />}>
					<CreateEventControl />
				</Suspense>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="inline-flex rounded-lg border border-border p-0.5">
					{viewTabs.map((tab) => {
						const Icon = tab.icon;
						const active = view === tab.id;
						return (
							<Link
								key={tab.id}
								href={tab.href}
								// aria-current marks the active tab for assistive tech, which the styling
								// alone did not convey.
								aria-current={active ? "page" : undefined}
								className={
									active
										? "inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-semibold text-foreground"
										: "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
								}
							>
								<Icon className="size-4" />
								{tab.label}
							</Link>
						);
					})}
				</div>

				{view === "calendar" ? (
					<div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start sm:gap-2">
						<Button asChild variant="outline" size="sm">
						<Link href={monthHref(today.year, today.month)}>Today</Link>
						</Button>
						<Button asChild variant="outline" size="icon" aria-label="Previous month">
							<Link href={monthHref(prev.year, prev.month)}>
								<ChevronLeft />
							</Link>
						</Button>
						<span className="min-w-0 flex-1 text-center text-sm font-semibold sm:min-w-36">
							{MONTH_NAMES[month - 1]} {year}
						</span>
						<Button asChild variant="outline" size="icon" aria-label="Next month">
							<Link href={monthHref(next.year, next.month)}>
								<ChevronRight />
							</Link>
						</Button>
					</div>
				) : null}
			</div>

			<Suspense
				key={`${view}-${year}-${month}`}
				fallback={view === "calendar" ? <MonthGridSkeleton /> : <EventsListSkeleton />}
			>
				{view === "calendar" ? (
					<MonthBody year={year} month={month} showPoints={showPoints} />
				) : (
					<ListBody />
				)}
			</Suspense>
		</div>
	);
}

async function CreateEventControl() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	return (
		<CreateEventSheet
			allowedTypes={typeLoad.ok ? allowedEventTypes(actor, typeLoad.rows) : []}
			typesUnavailable={!typeLoad.ok}
			canSetReadOnly={can(actor, "event:moderate")}
		/>
	);
}

async function MonthBody({
	year,
	month,
	showPoints,
}: {
	year: number;
	month: number;
	showPoints: boolean;
}) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const items = await repositories.calendar.getMonth(actor, { year, month }).catch(() => []);
	// A failed points read degrades to a plain calendar rather than taking the month down with it.
	const pointsByDay = showPoints
		? await repositories.retention.myPointsByDay(actor, { year, month }).catch(() => [])
		: [];
	return (
		<CalendarMonth items={items} year={year} month={month} pointsByDay={pointsByDay} />
	);
}

function monthHref(year: number, month: number): string {
	return `/portal/calendar?year=${year}&month=${month}`;
}

async function ListBody() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	const events = await loadEventList(repositories, actor).catch(() => null);
	return <EventsList events={events ?? []} types={typeLoad.ok ? typeLoad.rows : []} loadFailed={events === null} />;
}
