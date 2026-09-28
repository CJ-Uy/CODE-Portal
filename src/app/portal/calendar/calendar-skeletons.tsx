const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELLS = Array.from({ length: 35 }, (_, index) => index);
const ROWS = Array.from({ length: 6 }, (_, index) => index);

/**
 * Deliberately mirrors calendar-month.tsx: same wrapper, same weekday header, same
 * min-h-20 / sm:min-h-28 cells. A skeleton of the wrong size is worse than none, because
 * the page jumps when the real grid lands.
 */
export function MonthGridSkeleton() {
	return (
		<div
			role="status"
			aria-label="Loading month"
			className="overflow-hidden rounded-xl border border-border bg-card"
		>
			<span className="sr-only">Loading month</span>
			<div className="grid grid-cols-7 border-b border-border bg-secondary/30">
				{WEEKDAYS.map((day) => (
					<div
						key={day}
						className="px-2 py-2 text-center text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
					>
						<span className="hidden sm:inline">{day}</span>
						<span className="sm:hidden">{day[0]}</span>
					</div>
				))}
			</div>
			<div className="grid animate-pulse grid-cols-7 motion-reduce:animate-none">
				{CELLS.map((cell) => (
					<div
						key={cell}
						className="min-h-20 border-b border-r border-border p-1 last:border-r-0 sm:min-h-28 sm:p-1.5"
					>
						<div className="h-4 w-4 rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}

export function EventsListSkeleton() {
	return (
		<div role="status" aria-label="Loading events" className="grid animate-pulse gap-3 motion-reduce:animate-none">
			<span className="sr-only">Loading events</span>
			{ROWS.map((row) => (
				<div key={row} className="rounded-lg border border-border bg-card p-4">
					<div className="h-4 w-2/5 rounded bg-muted" />
					<div className="mt-2 h-3 w-3/5 rounded bg-muted/70" />
				</div>
			))}
		</div>
	);
}

/** Placeholder for the create button while the allowed event types resolve. */
export function CreateEventSkeleton() {
	return <div aria-hidden className="h-9 w-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />;
}
