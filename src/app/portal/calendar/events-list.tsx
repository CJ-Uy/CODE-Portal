import Link from "next/link";
import { ArrowRight, CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
	const [, month, day] = toLocalDate(event.startsAt).split("-").map(Number);
	return (
		<Link
			href={`/portal/calendar/${event.id}`}
			className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-secondary/40 active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-4 sm:px-4"
		>
			<div className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-border py-1.5 leading-none">
				<span className="text-[10px] font-semibold uppercase text-primary">{MONTHS[(month ?? 1) - 1]}</span>
				<span className="font-heading text-lg tabular-nums">{day}</span>
			</div>
			<div className="min-w-0 flex-1">
				<div className="grid min-w-0 gap-1 sm:flex sm:items-center sm:gap-2">
					<span className="truncate font-medium">{event.title}</span>
					<Badge className={cn("min-w-0 w-fit max-w-full truncate sm:max-w-32", chip)}>{labelFor(types, event.type)}</Badge>
					{event.myRole ? (
						<Badge variant="secondary" className="w-fit shrink-0 text-[10px]">
							{ROLE_LABEL[event.myRole]}
						</Badge>
					) : null}
					{event.readOnly ? (
						<Badge variant="secondary" className="w-fit shrink-0 text-[10px]">
							Info
						</Badge>
					) : null}
				</div>
				<p className="truncate text-sm text-muted-foreground">
					{timeRange(event.startsAt, event.endsAt, event.allDay)} · {event.place}
				</p>
			</div>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
				<span className="hidden sm:inline">{manage ? "Manage" : "View"}</span>
				<ArrowRight className="size-3.5" />
			</span>
		</Link>
	);
}

function Section({ title, events, types, emptyMessage }: { title: string; events: EventListItem[]; types: EventTypeRow[]; emptyMessage?: string }) {
	if (events.length === 0 && !emptyMessage) return null;
	return (
		<section className="grid gap-2" aria-labelledby={`events-${title.toLowerCase()}`}>
			<h2 id={`events-${title.toLowerCase()}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
			{events.length ? (
				<div className="grid gap-2">
					{events.map((event) => (
						<Card key={event.id} className="overflow-hidden"><Row event={event} types={types} /></Card>
					))}
				</div>
			) : <p className="text-sm text-muted-foreground">{emptyMessage}</p>}
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
			<Section title="Upcoming" events={upcoming} types={types} emptyMessage="No upcoming events yet." />
			<Section title="Past" events={past} types={types} />
		</div>
	);
}
