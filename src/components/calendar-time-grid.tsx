import Link from "next/link";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/lib/calendar";
import { layoutMonthBars } from "@/lib/calendar-layout";
import { dayViewHref, hourRange, layoutTimedEvents, minutesIntoDay, timedSpan, type TimedSpan } from "@/lib/calendar-time-grid";
import { colourClasses } from "@/lib/event-type-colours";
import { formatUtc8Time, toLocalDate } from "@/lib/date-slots";
import { AgendaList, EventBar, dayLabel } from "@/components/calendar-month";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Single-day events with a real start time sit in the hour rows; everything else goes in the all-day strip. */
function isTimed(item: CalendarItem): item is CalendarItem & { startsAt: string } {
	return Boolean(item.startsAt) && !item.allDay && item.date === item.endDate;
}

function sortByStart(items: CalendarItem[]): CalendarItem[] {
	return [...items].sort((a, b) => `${a.date}${a.startsAt ?? ""}`.localeCompare(`${b.date}${b.startsAt ?? ""}`));
}

function hourLabel(hour: number): string {
	if (hour === 0 || hour === 24) return "12 AM";
	if (hour === 12) return "12 PM";
	return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/**
 * Week (seven days) or Day (one) view: an all-day strip on top, then hour rows with timed events
 * placed by their Manila start and end. Server-rendered like the month grid; every position is a
 * percentage of the day's height, so the hour height can change per breakpoint in CSS alone.
 */
export function CalendarTimeGrid({ days, items }: { days: string[]; items: CalendarItem[] }) {
	const todayIso = toLocalDate(new Date());
	const columns = days.length;
	const isWeek = columns > 1;
	const byId = new Map(items.map((item) => [item.id, item]));

	const strip = items.filter((item) => !isTimed(item));
	// One "week" row of the given days, with a lane per item so nothing is hidden behind "+N more".
	const { bars } = layoutMonthBars(
		strip.map((item) => ({ id: item.id, startDate: item.date, endDate: item.endDate })),
		[days],
		Math.max(1, strip.length),
	);

	const timedByDay = new Map<string, Array<TimedSpan & { item: CalendarItem & { startsAt: string } }>>();
	for (const item of items) {
		if (!isTimed(item)) continue;
		const list = timedByDay.get(item.date) ?? [];
		list.push({ ...timedSpan(item), item });
		timedByDay.set(item.date, list);
	}
	const { startHour, endHour } = hourRange([...timedByDay.values()].flat());
	const rangeStart = startHour * 60;
	const rangeMinutes = (endHour - startHour) * 60;
	const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
	const nowMinutes = days.includes(todayIso) ? minutesIntoDay(new Date().toISOString(), todayIso) : null;

	const gridStyle: CSSProperties = { gridTemplateColumns: `var(--gutter) repeat(${columns}, minmax(0, 1fr))` };

	return (
		<div className="grid gap-5">
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					Nothing on the calendar {isWeek ? `in the week of ${dayLabel(days[0])}` : `on ${dayLabel(days[0])}`}.
				</p>
			) : null}

			<div className="overflow-hidden rounded-xl border border-border bg-card [--gutter:2.5rem] [--hour:2.75rem] sm:[--gutter:3.5rem] sm:[--hour:3rem]">
				<div className="grid border-b border-border bg-secondary/30" style={gridStyle}>
					<div />
					{days.map((iso) => {
						const isToday = iso === todayIso;
						const weekday = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
						const number = (
							<span
								className={cn(
									"grid size-7 place-items-center rounded-full text-sm tabular-nums",
									isToday ? "bg-accent font-semibold text-accent-foreground" : "text-foreground",
								)}
							>
								{Number(iso.slice(8, 10))}
							</span>
						);
						const label = (
							<>
								<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									<span className={cn(isWeek && "hidden sm:inline")}>{weekday}</span>
									{isWeek ? <span className="sm:hidden">{weekday[0]}</span> : null}
								</span>
								{number}
							</>
						);
						return isWeek ? (
							<Link
								key={iso}
								href={dayViewHref(iso)}
								aria-label={`Open ${dayLabel(iso)}`}
								className="flex min-w-0 flex-col items-center gap-0.5 border-l border-border py-1.5 transition-colors hover:bg-secondary/60"
							>
								{label}
							</Link>
						) : (
							<div key={iso} className="flex items-center gap-2 border-l border-border px-3 py-1.5">
								{label}
							</div>
						);
					})}
				</div>

				{bars.length ? (
					<div className="grid border-b border-border" style={gridStyle}>
						<div className="px-1 py-1 text-right text-[10px] leading-tight text-muted-foreground sm:px-2">All day</div>
						<div
							className="grid gap-y-0.5 border-l border-border px-0.5 py-1"
							style={{ gridColumn: `2 / span ${columns}`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
						>
							{bars.map((bar) => {
								const item = byId.get(bar.item.id);
								return item ? <EventBar key={item.id} item={item} bar={bar} /> : null;
							})}
						</div>
					</div>
				) : null}

				<div className="grid" style={gridStyle}>
					<div className="relative" style={{ height: `calc(${hours.length} * var(--hour))` }}>
						{hours.map((hour, index) =>
							index === 0 ? null : (
								<span
									key={hour}
									className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground sm:right-2"
									style={{ top: `calc(${index} * var(--hour))` }}
								>
									{hourLabel(hour)}
								</span>
							),
						)}
					</div>

					{days.map((iso) => {
						const placements = layoutTimedEvents(timedByDay.get(iso) ?? []);
						return (
							<div key={iso} className={cn("relative min-w-0 border-l border-border", iso === todayIso && "bg-accent/5")}>
								{hours.map((hour) => (
									<div key={hour} aria-hidden className="h-[var(--hour)] border-t border-border/60 first:border-t-0" />
								))}

								{placements.map(({ item: span, column, columns: split }) => {
									const item = span.item;
									const colour = colourClasses(item.colour);
									const time = item.endsAt
										? `${formatUtc8Time(new Date(item.startsAt))} – ${formatUtc8Time(new Date(item.endsAt))}`
										: formatUtc8Time(new Date(item.startsAt));
									const style: CSSProperties = {
										top: `${((span.start - rangeStart) / rangeMinutes) * 100}%`,
										height: `${((span.end - span.start) / rangeMinutes) * 100}%`,
										left: `${(column / split) * 100}%`,
										width: `${100 / split}%`,
									};
									const body = (
										<>
											{/* The tint sits on an opaque card so hour lines and overlapping blocks do not show through. */}
											<span className={cn("absolute inset-0", colour.chip)} aria-hidden />
											<span className={cn("absolute inset-y-0 left-0 w-0.5", colour.dot)} aria-hidden />
											{/* A phone's week column is ~40px: one clipped line reads better than letters stacked vertically. */}
											<span className={cn("relative block min-w-0 font-medium [overflow-wrap:anywhere]", isWeek && "whitespace-nowrap sm:whitespace-normal")}>{item.title}</span>
											<span className={cn("relative block tabular-nums text-muted-foreground", isWeek && "hidden sm:block")}>{time}</span>
										</>
									);
									const blockClass = cn(
										"absolute overflow-hidden rounded-md bg-card py-0.5 pl-1.5 pr-1 text-[11px] leading-tight text-foreground ring-1 ring-card sm:text-xs",
										item.endDate < todayIso && "opacity-60",
									);
									return item.href ? (
										<Link
											key={item.id}
											href={item.href}
											title={`${item.title}, ${time}`}
											style={style}
											className={cn(blockClass, "transition-opacity hover:opacity-80")}
										>
											{body}
										</Link>
									) : (
										<div key={item.id} title={`${item.title}, ${time}`} style={style} className={blockClass}>
											{body}
										</div>
									);
								})}

								{iso === todayIso && nowMinutes !== null && nowMinutes >= rangeStart && nowMinutes <= rangeStart + rangeMinutes ? (
									<div
										aria-hidden
										className="pointer-events-none absolute inset-x-0 h-0.5 bg-accent"
										style={{ top: `${((nowMinutes - rangeStart) / rangeMinutes) * 100}%` }}
									>
										<span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-accent" />
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</div>

			{/* Phones only, week only: seven columns are too narrow to read titles, so the week repeats as rows. */}
			{isWeek && items.length ? (
				<section aria-labelledby="week-agenda" className="grid gap-2 sm:hidden">
					<h2 id="week-agenda" className="font-sans text-sm font-semibold text-muted-foreground">
						Week at a glance
					</h2>
					<AgendaList items={sortByStart(items)} todayIso={todayIso} />
				</section>
			) : null}
		</div>
	);
}
