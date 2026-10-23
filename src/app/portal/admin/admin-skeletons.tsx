import { LoadingScreen, RowsSkeleton, Skeleton } from "@/components/ui/skeleton";

/** The AdminIntro header (admin-intro.tsx): sans title over a short description and a hairline. */
function AdminHeaderSkeleton() {
	return (
		<div className="grid gap-2 border-b border-border/60 pb-5">
			<Skeleton className="h-9 w-56 max-w-full sm:h-10" />
			<Skeleton className="h-5 w-full max-w-xl bg-muted/70" />
		</div>
	);
}

/** Most admin tools: the AdminIntro header, then a list. Each section's loading.tsx uses this. */
export function AdminPageLoading() {
	return (
		<LoadingScreen label="Loading admin page">
			<AdminHeaderSkeleton />
			<RowsSkeleton rows={6} className="rounded-xl border-border/60" />
		</LoadingScreen>
	);
}

/** Data and records pages (admin/data/*): heading, filter row, then a wide table in a card. */
export function AdminDataLoading() {
	return (
		<LoadingScreen label="Loading records" className="gap-5">
			<div className="grid gap-2 border-b border-border pb-5">
				<Skeleton className="h-9 w-48 sm:h-10" />
				<Skeleton className="h-5 w-full max-w-xl bg-muted/70" />
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<Skeleton className="h-10 w-56 rounded-md" />
				<Skeleton className="h-10 w-56 rounded-md" />
				<Skeleton className="h-10 w-20 rounded-md" />
			</div>
			<div className="grid gap-3">
				<Skeleton className="h-6 w-28" />
				<div className="overflow-hidden rounded-lg border border-border bg-card">
					<div className="h-9 border-b border-border bg-muted/20" />
					<div className="divide-y divide-border">
						{Array.from({ length: 8 }, (_, index) => (
							<div key={index} className="flex gap-6 px-4 py-3">
								<Skeleton className="h-4 w-48" />
								<Skeleton className="h-4 w-20 bg-muted/70" />
								<Skeleton className="ml-auto h-4 w-10 bg-muted/70" />
							</div>
						))}
					</div>
				</div>
			</div>
		</LoadingScreen>
	);
}
