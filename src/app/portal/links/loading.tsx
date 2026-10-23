import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors LinksWorkspace: header and actions, help line, toolbar, then link cards. */
export default function LinksLoading() {
	return (
		<LoadingScreen label="Loading links" className="gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<PageHeaderSkeleton eyebrow />
				<div className="flex gap-2">
					<Skeleton className="h-11 w-24 rounded-md" />
					<Skeleton className="h-11 w-36 rounded-md" />
				</div>
			</div>
			<div className="h-[3.25rem] rounded-lg border border-border bg-card" />
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
				<Skeleton className="h-11 w-32 rounded-md" />
				<Skeleton className="h-11 min-w-56 flex-1 rounded-md" />
			</div>
			<div className="grid gap-2">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="grid gap-2 rounded-lg border border-border bg-card p-4">
						<div className="flex justify-between gap-3">
							<Skeleton className="h-4 w-48 max-w-full" />
							<Skeleton className="h-3 w-14 bg-muted/70" />
						</div>
						<Skeleton className="h-3 w-32" />
						<Skeleton className="h-3 w-3/5 bg-muted/70" />
						<div className="mt-1 flex justify-between gap-3 border-t border-border pt-3">
							<Skeleton className="h-3 w-24 bg-muted/70" />
							<Skeleton className="h-11 w-28 rounded-md" />
						</div>
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
