import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the library home (page.tsx): header and actions, pitch banner, search, filters beside the shelves. */
export default function LibraryLoading() {
	return (
		<LoadingScreen label="Loading library" className="mx-auto max-w-6xl">
			<div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
				<PageHeaderSkeleton eyebrow />
				<div className="flex flex-wrap gap-2">
					<Skeleton className="h-10 w-40 rounded-md" />
					<Skeleton className="h-10 w-24 rounded-md" />
					<Skeleton className="h-10 w-20 rounded-md" />
				</div>
			</div>

			<div className="grid gap-2 rounded-xl border border-border bg-secondary/50 p-4">
				<Skeleton className="h-3 w-36" />
				<Skeleton className="h-5 w-72 max-w-full" />
				<Skeleton className="h-4 w-full max-w-xl bg-muted/70" />
			</div>

			<div className="flex gap-2">
				<Skeleton className="h-11 flex-1 rounded-md" />
				<Skeleton className="h-11 w-24 rounded-md" />
			</div>

			<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
				<div className="hidden gap-3 rounded-xl border border-border bg-card p-4 lg:grid">
					{Array.from({ length: 6 }, (_, index) => (
						<Skeleton key={index} className="h-4 w-3/4" />
					))}
				</div>
				<div className="grid min-w-0 gap-8">
					{["Most saved this term", "Recently added"].map((section) => (
						<div key={section} className="grid gap-3">
							<Skeleton className="h-6 w-48" />
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{Array.from({ length: 3 }, (_, index) => (
									<div key={index} className="grid h-32 content-start gap-2 rounded-xl border border-border bg-card p-4">
										<Skeleton className="h-3 w-16" />
										<Skeleton className="h-4 w-4/5" />
										<Skeleton className="h-3 w-full bg-muted/70" />
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</LoadingScreen>
	);
}
