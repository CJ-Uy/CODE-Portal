import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the announcements feed: header, then one card per notice. */
export default function AnnouncementsLoading() {
	return (
		<LoadingScreen label="Loading announcements" className="gap-5">
			<PageHeaderSkeleton eyebrow />
			<div className="grid gap-4">
				{Array.from({ length: 3 }, (_, index) => (
					<div key={index} className="grid gap-3 rounded-lg border border-border bg-card p-5">
						<div className="flex gap-2">
							<Skeleton className="h-5 w-16 rounded-full" />
							<Skeleton className="ml-auto h-3 w-20 bg-muted/70" />
						</div>
						<Skeleton className="h-6 w-2/3" />
						<Skeleton className="h-4 w-full bg-muted/70" />
						<Skeleton className="h-4 w-4/5 bg-muted/70" />
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
