import { RouteFallback } from "@/components/portal/route-fallback";
import { LoadingScreen, PageLoading, Skeleton } from "@/components/ui/skeleton";

/** Home's shape on Home; a plain page shape while a deep link's own skeleton is on its way. */
export default function PortalLoading() {
	return <RouteFallback path="/portal" match={<HomeLoading />} other={<PageLoading />} />;
}

/**
 * Mirrors the Home page (page.tsx): title and date, upcoming events beside the retention card,
 * the metric row, then announcements beside the library.
 */
function HomeLoading() {
	return (
		<LoadingScreen label="Loading home">
			<div className="grid gap-2">
				<Skeleton className="h-9 w-28" />
				<Skeleton className="h-4 w-40" />
			</div>

			<div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<div className="grid gap-4 rounded-lg border border-border bg-card p-5">
					<div className="flex items-center justify-between gap-3">
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-8 w-24 rounded-md" />
					</div>
					{Array.from({ length: 3 }, (_, index) => (
						<div key={index} className="grid gap-2 py-2">
							<Skeleton className="h-4 w-3/5" />
							<Skeleton className="h-3 w-2/5 bg-muted/70" />
						</div>
					))}
				</div>
				<div className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
					<Skeleton className="h-6 w-36" />
					<Skeleton className="h-3 w-24 bg-muted/70" />
					<Skeleton className="h-3 w-full rounded-full" />
					<Skeleton className="h-4 w-2/3" />
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="grid gap-3 rounded-lg border border-border bg-card p-5">
						<Skeleton className="h-3 w-20" />
						<Skeleton className="h-8 w-12" />
						<Skeleton className="h-3 w-32 bg-muted/70" />
					</div>
				))}
			</div>

			<div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
				<div className="h-56 rounded-lg border border-border bg-card" />
				<div className="h-56 rounded-lg border border-border bg-card" />
			</div>
		</LoadingScreen>
	);
}
