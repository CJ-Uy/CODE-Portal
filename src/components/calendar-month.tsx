import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/lib/calendar";
import { layoutMonthBars, toWeeks } from "@/lib/calendar-layout";
import { colourClasses } from "@/lib/event-type-colours";
import { formatUtc8Time, toLocalDate } from "@/lib/date-slots";
import { formatPoints } from "@/lib/points";
import type { PointsDay } from "@/db/repositories/retention";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Three bars plus a "+N more" line is what fits a 375px cell without the grid growing unbounded.
const MAX_LANES = 3;

function isoFor(year: number, month: number, day: number): string {
	return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function CalendarMonth({
	items,
	year,
	month,
	pointsByDay = [],
}: {
	items: CalendarItem[];
	year: number;
	month: number;
	pointsByDay?: PointsDay[];
}) {
	const todayIso = toLocalDate(new Date());
	const pointsFor = new Map(pointsByDay.map((day) => [day.date, day.points]));

	// Sunday-first, matching this grid's own history. date-slots' buildMonthGrid is Monday-first and
	// drives the create-event picker; reusing it here would silently move the week start.
	const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const cells: (string | null)[] = [
		...Array.from({ length: firstWeekday }, () => null),
		...Array.from({ length: daysInMonth }, (_, i) => isoFor(year, month, i + 1)),
	];
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks = toWeeks(cells);
	const byId = new Map(items.map((item) => [item.id, item]));
	const { bars, overflowByDay } = layoutMonthBars(
		items.map((item) => ({ id: item.id, startDate: item.date, endDate: item.endDate })),
		weeks,
		MAX_LANES,
	);

	return (
		<div className="grid gap-5">
		<div className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="grid grid-cols-7 border-b border-border bg-secondary/30">
				{WEEKDAYS.map((day) => (
					<div key={day} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<span className="hidden sm:inline">{day}</span>
						<span className="sm:hidden">{day[0]}</span>
					</div>
				))}
			</div>

			{weeks.map((week, weekIndex) => {
				const weekBars = bars.filter((bar) => bar.weekIndex === weekIndex);
				return (
					<div key={`week-${weekIndex}`} className="relative">
						{/* Day cells carry the borders, the date number, and a spacer sized to the lanes. */}
						<div className="grid grid-cols-7">
							{week.map((iso, cellIndex) => {
								if (!iso) {
									return (
										<div
											key={`blank-${weekIndex}-${cellIndex}`}
											className="min-h-20 border-b border-r border-border bg-secondary/10 last:border-r-0 sm:min-h-28"
										/>
									);
								}
								const isToday = iso === todayIso;
								const overflow = overflowByDay.get(iso) ?? 0;
								const dayPoints = pointsFor.get(iso) ?? 0;
								return (
									<div
										key={iso}
										className={cn(
											"min-h-20 border-b border-r border-border p-1 sm:min-h-28 sm:p-1.5",
											(cellIndex + 1) % 7 === 0 && "border-r-0",
										isToday && "bg-accent/5",
										)}
										// Every earning day states its value for assistive tech and on hover.
										title={dayPoints > 0 ? `${formatPoints(dayPoints)} points on ${iso}` : undefined}
										aria-label={dayPoints > 0 ? `${iso}, ${formatPoints(dayPoints)} points` : undefined}
									>
										<div className="flex items-start justify-between gap-1">
											{dayPoints !== 0 ? (
												<span className="min-w-0 truncate rounded bg-accent/15 px-1 text-[11px] font-semibold tabular-nums text-accent">
													{dayPoints > 0 ? "+" : ""}
													{formatPoints(dayPoints)}
												</span>
											) : (
												<span />
											)}
											<span
												className={cn(
													"grid size-6 shrink-0 place-items-center rounded-full text-xs tabular-nums",
													isToday ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground",
												)}
											>
												{Number(iso.slice(8, 10))}
											</span>
										</div>
										{/* Reserves the vertical space the absolutely-positioned bars occupy:
										    MAX_LANES lanes of 1.0625rem plus the 0.125rem gaps between them. */}
										<div aria-hidden className="h-[3.4375rem]" />
										{overflow > 0 ? <span className="text-[11px] text-muted-foreground">+{overflow} more</span> : null}
									</div>
								);
							})}
						</div>

						{/* Bar layer. A bar spans real grid columns, so a multi-day event is one element
						    crossing several cells rather than a chip repeated per day. */}
						{/* Not aria-hidden: the event titles live here now, so hiding this layer would
						    hide every event from assistive tech. */}
						<div className="pointer-events-none absolute inset-x-0 top-8 grid grid-cols-7 gap-y-0.5 px-1 sm:top-9 sm:px-1.5">
							{weekBars.map((bar) => {
								const item = byId.get(bar.item.id);
								if (!item) return null;
								const colour = colourClasses(item.colour);
								const body = (
									<div
										className={cn(
											"flex h-[1.0625rem] items-center gap-1 overflow-hidden px-1 text-[11px] leading-tight sm:text-xs",
											colour.chip,
											// Square off the clipped end so a continued bar reads as continuing.
											bar.continuesLeft ? "rounded-l-none" : "rounded-l",
											bar.continuesRight ? "rounded-r-none" : "rounded-r",
										)}
									>
										{bar.continuesLeft ? <span className="shrink-0 text-muted-foreground">‹</span> : null}
										{/* The dot marks where an event STARTS, so any bar carrying its real start gets
										    one whatever its span. Continuation segments show the chevron instead. */}
										{bar.continuesLeft ? null : <span className={cn("size-1.5 shrink-0 rounded-full", colour.dot)} />}
										<span className="min-w-0 flex-1 truncate">{item.title}</span>
										{bar.continuesRight ? <span className="shrink-0 text-muted-foreground">›</span> : null}
									</div>
								);
								return (
									<div
										key={`${bar.item.id}-${bar.weekIndex}`}
										className="pointer-events-auto min-w-0"
										style={{ gridColumn: `${bar.startCol} / ${bar.endCol + 1}`, gridRow: bar.lane + 1 }}
									>
										{item.href ? (
											<Link
												href={item.href}
												className="block rounded transition-[opacity,transform] hover:opacity-80 active:scale-[0.98]"
											>
												{body}
											</Link>
										) : (
											body
										)}
									</div>
								);
							})}
						</div>
					</div>
				);
			})}

		</div>
		<MonthAgenda items={items} year={year} month={month} todayIso={todayIso} />
		</div>
	);
}

/**
 * Phones only: the grid's bars are too narrow to read there, so the month's items repeat below it as rows
 * a thumb can hit. Days already over stay listed but quieter, so the month still reads whole.
 */
function MonthAgenda({ items, year, month, todayIso }: { items: CalendarItem[]; year: number; month: number; todayIso: string }) {
	const first = isoFor(year, month, 1);
	const last = isoFor(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
	const rows = items
		.filter((item) => item.endDate >= first && item.date <= last)
		.sort((a, b) => `${a.date}${a.startsAt ?? ""}`.localeCompare(`${b.date}${b.startsAt ?? ""}`));
	return (
		<section aria-labelledby="month-agenda" className="grid gap-2 sm:hidden">
			<h2 id="month-agenda" className="font-sans text-sm font-semibold text-muted-foreground">
				{rows.length ? `${MONTHS[month - 1]} at a glance` : `Nothing on the calendar in ${MONTHS[month - 1]}`}
			</h2>
			{rows.length ? (
				<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
					{rows.map((item) => {
						const past = item.endDate < todayIso;
						const colour = colourClasses(item.colour);
						const day = (iso: string) => (iso === todayIso ? "Today" : dayLabel(iso));
						const when = [
							item.endDate !== item.date ? `${day(item.date)} to ${day(item.endDate)}` : day(item.date),
							item.startsAt ? formatUtc8Time(new Date(item.startsAt)) : null,
						]
							.filter(Boolean)
							.join(" · ");
						const body = (
							<>
								<span className={cn("mt-1.5 size-2 shrink-0 rounded-full", colour.dot)} aria-hidden />
								<span className="min-w-0 flex-1">
									<span className="block font-medium [overflow-wrap:anywhere]">{item.title}</span>
									<span className="block text-sm text-muted-foreground">
										{when}
									</span>
								</span>
							</>
						);
						const rowClass = cn("flex min-w-0 items-start gap-3 px-4 py-3", past && "opacity-60");
						return (
							<li key={item.id}>
								{item.href ? (
									<Link href={item.href} className={cn(rowClass, "transition-colors active:bg-secondary/60")}>
										{body}
									</Link>
								) : (
									<div className={rowClass}>{body}</div>
								)}
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}

function dayLabel(iso: string): string {
	return new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${iso}T00:00:00Z`));
}
