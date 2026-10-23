import { RouteFallback } from "@/components/portal/route-fallback";
import { LoadingScreen, PageLoading, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the guides index: centered search hero, then a grid of guide cards. */
function GuidesIndexLoading() {
	return (
		<LoadingScreen label="Loading guides" className="gap-8">
			<div className="grid justify-items-center gap-4 rounded-xl border border-border/60 bg-card px-5 py-10 sm:px-8 sm:py-12">
				<Skeleton className="size-12 rounded-full" />
				<Skeleton className="h-3 w-24" />
				<Skeleton className="h-9 w-64 max-w-full" />
				<Skeleton className="h-4 w-80 max-w-full bg-muted/70" />
				<Skeleton className="h-11 w-full max-w-xl rounded-md" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="grid h-48 content-start gap-4 rounded-lg border border-border bg-card p-5">
						<Skeleton className="size-10 rounded-lg" />
						<Skeleton className="h-5 w-3/4" />
						<Skeleton className="h-4 w-full bg-muted/70" />
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}

/** The guide index's shape on the index; a plain page for a single guide. */
export default function GuidesLoading() {
	return <RouteFallback path="/portal/guides" match={<GuidesIndexLoading />} other={<PageLoading />} />;
}
