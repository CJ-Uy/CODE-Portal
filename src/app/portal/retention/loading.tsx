import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the points page (history tab): header, tabs, filters, summary card, stat tiles, history. */
export default function RetentionLoading() {
	return (
		<LoadingScreen label="Loading points" className="gap-5">
			<PageHeaderSkeleton />
			<div className="flex gap-2 border-b border-border pb-2">
				<Skeleton className="h-6 w-20" />
				<Skeleton className="h-6 w-24 bg-muted/70" />
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<Skeleton className="h-10 w-48 rounded-md" />
				<Skeleton className="h-10 w-20 rounded-md" />
			</div>
			<div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center">
				<Skeleton className="size-32 self-center rounded-full" />
				<div className="grid flex-1 gap-2">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-10 w-28" />
					<Skeleton className="h-4 w-3/4 bg-muted/70" />
					<Skeleton className="h-1.5 w-full rounded-full" />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="grid gap-2 rounded-lg border border-border bg-card p-3">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-7 w-10" />
					</div>
				))}
			</div>
			<div className="h-96 rounded-lg border border-border bg-card" />
		</LoadingScreen>
	);
}
