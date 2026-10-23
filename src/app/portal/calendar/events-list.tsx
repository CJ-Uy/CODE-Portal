import Link from "next/link";
import { ArrowRight, CalendarX2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DateTile } from "@/components/portal/date-tile";
import { EmptyState } from "@/components/portal/empty-state";
import { type EventTypeRow, labelFor } from "@/db/repositories/eventTypeRules";
import { colourClasses } from "@/lib/event-type-colours";
import { formatEventRange, formatUtc8Time, toLocalDate } from "@/lib/date-slots";
import { inclusiveEndDate } from "@/lib/calendar";
import { cn } from "@/lib/utils";

export type EventListItem = {
	id: string;
	title: string;
	type: string;
	place: string;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	readOnly: boolean;
	myRole: "owner" | "admin" | "scanner" | null;
	canModerate: boolean;
};

const ROLE_LABEL: Record<NonNullable<EventListItem["myRole"]>, string> = {
	owner: "Hosting",
	admin: "Managing",
	scanner: "Scanning",
};

function timeRange(start: Date, end: Date | null, allDay: boolean): string {
	// Multi-day and all-day events need the span, not just clock times, or a three-day event reads
	// as if it were over by the afternoon.
	if (allDay || (end && toLocalDate(start) !== toLocalDate(new Date(end.getTime() - 1)))) {
		return formatEventRange(start, end, allDay);
	}
	const t = formatUtc8Time;
	return end ? `${t(start)} - ${t(end)}` : t(start);
}

function Row({ event, types }: { event: EventListItem; types: EventTypeRow[] }) {
	const manage = event.myRole === "owner" || event.myRole === "admin" || event.canModerate;
	const chip = colourClasses(types.find((t) => t.type === event.type)?.colour ?? "slate").chip;
	return (
		<Link
			href={`/portal/calendar/${event.id}`}
			className="flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-secondary/40 active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-4"
		>
			<DateTile date={event.startsAt} today={toLocalDate(event.startsAt) === toLocalDate(new Date())} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span className="min-w-0 font-medium [overflow-wrap:anywhere]">{event.title}</span>
					{/* Official is the usual case, so only the other types earn a badge. */}
					{event.type !== "official" ? <Badge className={cn("min-w-0 max-w-full truncate sm:max-w-32", chip)}>{labelFor(types, event.type)}</Badge> : null}
					{event.myRole ? (
						<Badge variant="secondary" className="shrink-0 text-[11px]">
							{ROLE_LABEL[event.myRole]}
						</Badge>
					) : null}
					{event.readOnly ? (
						<Badge variant="secondary" className="shrink-0 text-[11px]">
							Info
						</Badge>
					) : null}
				</div>
				<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
					{timeRange(event.startsAt, event.endsAt, event.allDay)} · {event.place}
				</p>
			</div>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
				{manage ? <span className="hidden sm:inline">Manage</span> : null}
				<ArrowRight className="size-3.5" aria-hidden />
			</span>
		</Link>
	);
}

function Rows({ events, types }: { events: EventListItem[]; types: EventTypeRow[] }) {
	return (
		<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
			{events.map((event) => (
				<li key={event.id}>
					<Row event={event} types={types} />
				</li>
			))}
		</ul>
	);
}

function Section({ title, events, types, emptyMessage }: { title: string; events: EventListItem[]; types: EventTypeRow[]; emptyMessage: string }) {
	return (
		<section className="grid gap-2" aria-labelledby={`events-${title.toLowerCase()}`}>
			<h2 id={`events-${title.toLowerCase()}`} className="font-sans! text-sm font-semibold text-muted-foreground">{title}</h2>
			{events.length ? <Rows events={events} types={types} /> : <p className="text-sm text-muted-foreground">{emptyMessage}</p>}
		</section>
	);
}

export function groupEventsByTime(events: EventListItem[], now = new Date()) {
	const today = toLocalDate(now);
	const current: EventListItem[] = [];
	const upcoming: EventListItem[] = [];
	const past: EventListItem[] = [];
	for (const event of events) {
		if (inclusiveEndDate(event.startsAt, event.endsAt) < today) past.push(event);
		else if (toLocalDate(event.startsAt) > today) upcoming.push(event);
		else current.push(event);
	}
	const byStart = (a: EventListItem, b: EventListItem) => a.startsAt.getTime() - b.startsAt.getTime();
	current.sort(byStart);
	upcoming.sort(byStart);
	past.sort((a, b) => (b.endsAt ?? b.startsAt).getTime() - (a.endsAt ?? a.startsAt).getTime());
	return { current, upcoming, past };
}

export function EventsList({ events, types, loadFailed = false }: { events: EventListItem[]; types: EventTypeRow[]; loadFailed?: boolean }) {
	if (loadFailed) {
		return <EmptyState icon={CalendarX2} title="Could not load events" description="Refresh the page to try again." />;
	}
	if (events.length === 0) {
		return (
			<EmptyState
				icon={CalendarX2}
				title="No events yet"
				description="Events will appear here when they are published."
			/>
		);
	}

	const { current, upcoming, past } = groupEventsByTime(events);

	return (
		<div className="grid gap-5">
			<Section title="Today" events={current} types={types} emptyMessage="Nothing scheduled today." />
			<Section title="Upcoming" events={upcoming} types={types} emptyMessage="Nothing else coming up yet." />
			{/* Past events grow every week; they stay one tap away instead of lengthening the page. */}
			{past.length ? (
				<details className="group grid gap-2">
					<summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
						<ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
						Past events ({past.length})
					</summary>
					<div className="mt-2">
						<Rows events={past} types={types} />
					</div>
				</details>
			) : null}
		</div>
	);
}
