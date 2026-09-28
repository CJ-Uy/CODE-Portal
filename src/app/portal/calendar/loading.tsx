import { MonthGridSkeleton } from "./calendar-skeletons";

/**
 * Shown on the first navigation into the route. Once here, changing month or view is
 * handled by the Suspense boundary in page.tsx instead, since loading.tsx does not
 * re-trigger for a search param change.
 */
export default function CalendarLoading() {
	return (
		<div role="status" aria-label="Loading calendar" className="grid gap-5">
			<span className="sr-only">Loading calendar</span>
			<div className="flex flex-wrap items-start justify-between gap-4 animate-pulse motion-reduce:animate-none">
				<div className="grid gap-2">
					<div className="h-3 w-28 rounded bg-muted" />
					<div className="h-8 w-40 rounded bg-muted" />
				</div>
				<div className="h-9 w-32 rounded-lg bg-muted" />
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 animate-pulse motion-reduce:animate-none">
				<div className="h-9 w-44 rounded-lg bg-muted" />
				<div className="h-9 w-56 rounded-lg bg-muted" />
			</div>
			<MonthGridSkeleton />
		</div>
	);
}
