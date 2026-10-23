import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the notifications list: header with "Mark all read", then compact cards. */
export default function NotificationsLoading() {
	return (
		<LoadingScreen label="Loading notifications" className="gap-5">
			<div className="flex items-end justify-between gap-4">
				<PageHeaderSkeleton eyebrow description={false} />
				<Skeleton className="h-8 w-28 rounded-md" />
			</div>
			<div className="grid gap-3">
				{Array.from({ length: 5 }, (_, index) => (
					<div key={index} className="grid gap-2 rounded-lg border border-border bg-card p-5">
						<Skeleton className="h-4 w-1/2" />
						<Skeleton className="h-3 w-3/4 bg-muted/70" />
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
