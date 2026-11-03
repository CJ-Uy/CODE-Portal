import { RouteFallback } from "@/components/portal/route-fallback";
import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";
import { AdminPageLoading } from "./admin-skeletons";

/** The tool directory's shape on the admin overview; the plain admin page shape below it. */
export default function AdminLoading() {
	return <RouteFallback path="/portal/admin" match={<AdminOverviewLoading />} other={<AdminPageLoading />} />;
}

/**
 * Mirrors the admin overview (page.tsx + AdminTools): header, search and section chips, then the
 * two-column tool directory.
 */
function AdminOverviewLoading() {
	return (
		<LoadingScreen label="Loading admin" className="gap-8">
			<div className="grid gap-3 border-b border-border/60 pb-6">
				<Skeleton className="h-9 w-32 sm:h-10" />
				<Skeleton className="h-5 w-full max-w-xl bg-muted/70" />
			</div>
			<div className="grid gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<Skeleton className="h-11 w-full rounded-md sm:max-w-md" />
					<Skeleton className="h-4 w-16 bg-muted/70" />
				</div>
				<div className="flex flex-wrap gap-1 border-b border-border/60 pb-3">
					{Array.from({ length: 5 }, (_, index) => (
						<Skeleton key={index} className="h-9 w-24 rounded-md" />
					))}
				</div>
			</div>
			<div className="grid items-start gap-8 lg:grid-cols-2">
				{Array.from({ length: 4 }, (_, group) => (
					<div key={group} className="grid gap-3">
						<div className="flex items-start gap-3">
							<Skeleton className="size-5" />
							<div className="grid flex-1 gap-1.5">
								<Skeleton className="h-6 w-40" />
								<Skeleton className="h-4 w-3/4 bg-muted/70" />
							</div>
						</div>
						<div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
							{Array.from({ length: 4 }, (_, row) => (
								<div key={row} className="grid gap-2 px-4 py-4">
									<Skeleton className="h-4 w-1/3" />
									<Skeleton className="h-3 w-2/3 bg-muted/70" />
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
