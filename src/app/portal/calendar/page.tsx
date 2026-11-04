import { Suspense } from "react";
import Link from "next/link";
import { Calendar1, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, List } from "lucide-react";
import { getRepositories } from "@/db";
import { allowedEventTypes } from "@/db/repositories/eventTypeRules";
import { Button } from "@/components/ui/button";
import { CalendarMonth } from "@/components/calendar-month";
import { CalendarTimeGrid } from "@/components/calendar-time-grid";
import { PageHeader } from "@/components/portal/page-header";
import { loadEventTypes } from "@/lib/event-type-load";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { estimateSeconds } from "@/lib/feedback/stats";
import { addDays, dayViewHref, parseIsoDay, weekDays } from "@/lib/calendar-time-grid";
import { toLocalDate, utc8Parts } from "@/lib/date-slots";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { canViewFeedbackArchive } from "@/server/feedback/archive-access";
import { CreateEventSheet } from "./create-event-sheet";
import { CreateEventSkeleton, EventsListSkeleton, MonthGridSkeleton, TimeGridSkeleton } from "./calendar-skeletons";
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
 * The boundary is keyed on view, year, month and day. Without the key React keeps the existing
 * boundary mounted and holds the previous month on screen until the new one arrives, which
 * reads as a dead click.
 */
export default async function CalendarPage({
	searchParams,
}: {
	searchParams: Promise<{ year?: string; month?: string; view?: string; date?: string }>;
}) {
	const params = await searchParams;
	const view = params.view === "list" || params.view === "week" || params.view === "day" ? params.view : "calendar";
	// Points overlay only exists where the points surface itself is enabled.
	const showPoints = isFeatureEnabled("retention");
	const today = utc8Parts(new Date());
	const todayIso = toLocalDate(new Date());

	// Week and Day are anchored on a Manila day (?date=); Month on ?year=&month=. Each tab carries the
	// other's position over, so switching views stays on the same stretch of time.
	const paramDate = parseIsoDay(params.date);
	const year = Number(params.year) || (paramDate ? Number(paramDate.slice(0, 4)) : today.year);
	const month = Number(params.month) || (paramDate ? Number(paramDate.slice(5, 7)) : today.month);
	const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
	const anchor = paramDate ?? (todayIso.startsWith(monthStart.slice(0, 7)) ? todayIso : monthStart);
	const days = view === "week" ? weekDays(anchor) : [anchor];

	const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
	const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

	const viewTabs = [
		{ id: "calendar", label: "Month", icon: CalendarDays, href: monthHref(year, month) },
		{ id: "week", label: "Week", icon: CalendarRange, href: weekHref(anchor) },
		{ id: "day", label: "Day", icon: Calendar1, href: dayViewHref(anchor) },
		{ id: "list", label: "List", icon: List, href: "/portal/calendar?view=list" },
	];
	const step = view === "week" ? 7 : 1;
	const rangeHref = view === "week" ? weekHref : dayViewHref;
	const unit = view === "week" ? "week" : "day";

	return (
		<div className="grid gap-5">
			<PageHeader
				title="Calendar"
				actions={
					<Suspense fallback={<CreateEventSkeleton />}>
						<CreateEventControl />
					</Suspense>
				}
			/>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="inline-flex rounded-lg border border-border bg-card p-0.5">
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
										? "inline-flex min-h-10 items-center gap-1.5 rounded-md bg-secondary px-3 text-sm font-semibold text-foreground"
										: "inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
								}
							>
								<Icon className="hidden size-4 sm:block" />
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
				) : view === "week" || view === "day" ? (
					<div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start sm:gap-2">
						<Button asChild variant="outline" size="sm">
							<Link href={rangeHref(todayIso)}>Today</Link>
						</Button>
						<Button asChild variant="outline" size="icon" aria-label={`Previous ${unit}`}>
							<Link href={rangeHref(addDays(anchor, -step))}>
								<ChevronLeft />
							</Link>
						</Button>
						<span className="min-w-0 flex-1 text-center text-sm font-semibold sm:min-w-44">{rangeLabel(days)}</span>
						<Button asChild variant="outline" size="icon" aria-label={`Next ${unit}`}>
							<Link href={rangeHref(addDays(anchor, step))}>
								<ChevronRight />
							</Link>
						</Button>
					</div>
				) : null}
			</div>

			<Suspense
				key={`${view}-${year}-${month}-${days[0]}`}
				fallback={
					view === "calendar" ? <MonthGridSkeleton /> : view === "list" ? <EventsListSkeleton /> : <TimeGridSkeleton />
				}
			>
				{view === "calendar" ? (
					<MonthBody year={year} month={month} showPoints={showPoints} />
				) : view === "list" ? (
					<ListBody />
				) : (
					<RangeBody days={days} />
				)}
			</Suspense>
		</div>
	);
}

async function CreateEventControl() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	// Feedback forms belong to CRS (survey:configure), so only they get the "attach a form" option. A failed read hides it.
	const offerFeedback = isFeatureEnabled("surveys") && can(actor, "survey:configure");
	const [typeLoad, templates] = await Promise.all([
		loadEventTypes(() => repositories.eventTypeRules.list()),
		offerFeedback ? repositories.surveys.listTemplates(actor).catch(() => []) : Promise.resolve([]),
	]);
	return (
		<CreateEventSheet
			allowedTypes={typeLoad.ok ? allowedEventTypes(actor, typeLoad.rows) : []}
			typesUnavailable={!typeLoad.ok}
			canSetReadOnly={can(actor, "event:moderate")}
			canViewArchive={canViewFeedbackArchive(actor)}
			feedbackTemplates={templates.map((template) => ({
				id: template.id,
				label: `${template.name} (${template.questionsJson.length} ${template.questionsJson.length === 1 ? "question" : "questions"}, ${formatEstimate(estimateSeconds(template.questionsJson)).toLowerCase()})`,
			}))}
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
	const [items, pointsByDay] = await Promise.all([
		repositories.calendar.getMonth(actor, { year, month }).catch(() => []),
		// A failed points read degrades to a plain calendar rather than taking the month down with it.
		showPoints ? repositories.retention.myPointsByDay(actor, { year, month }).catch(() => []) : [],
	]);
	return (
		<CalendarMonth items={items} year={year} month={month} pointsByDay={pointsByDay} />
	);
}

function monthHref(year: number, month: number): string {
	return `/portal/calendar?year=${year}&month=${month}`;
}

function weekHref(iso: string): string {
	return `/portal/calendar?view=week&date=${iso}`;
}

/** "Nov 1 – 7, 2026", "Oct 25 – Nov 1, 2026" or "Wed, Nov 4, 2026". The days are already Manila days. */
function rangeLabel(days: string[]): string {
	const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
	if (days.length === 1) {
		return new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(at(days[0]));
	}
	return new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).formatRange(at(days[0]), at(days[days.length - 1]));
}

/**
 * The calendar repository reads by month, so a week crossing a month boundary reads both months
 * (in parallel) and keeps only what overlaps the days shown. Birthdays and deadlines are per month,
 * so merging by id loses nothing.
 */
async function RangeBody({ days }: { days: string[] }) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const first = days[0];
	const last = days[days.length - 1];
	const months = [...new Set([first.slice(0, 7), last.slice(0, 7)])];
	const lists = await Promise.all(
		months.map((ym) =>
			repositories.calendar.getMonth(actor, { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) }).catch(() => []),
		),
	);
	const items = [...new Map(lists.flat().map((item) => [item.id, item])).values()].filter(
		(item) => item.endDate >= first && item.date <= last,
	);
	return <CalendarTimeGrid days={days} items={items} />;
}

async function ListBody() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const [typeLoad, events] = await Promise.all([
		loadEventTypes(() => repositories.eventTypeRules.list()),
		loadEventList(repositories, actor).catch(() => null),
	]);
	return <EventsList events={events ?? []} types={typeLoad.ok ? typeLoad.rows : []} loadFailed={events === null} />;
}
