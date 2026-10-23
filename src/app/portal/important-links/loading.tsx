import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Important links directory: header with its action, then grouped link lists in two columns. */
export default function ImportantLinksLoading() {
	return (
		<LoadingScreen label="Loading important links" className="gap-8">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/60 pb-5">
				<div className="grid gap-2">
					<Skeleton className="h-9 w-56 sm:h-10" />
					<Skeleton className="h-5 w-full max-w-xl bg-muted/70" />
				</div>
				<Skeleton className="h-10 w-32 rounded-md" />
			</div>
			<div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-2">
				{Array.from({ length: 4 }, (_, section) => (
					<div key={section} className="grid gap-3">
						<Skeleton className="h-6 w-40" />
						<div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
							{Array.from({ length: 3 }, (_, row) => (
								<div key={row} className="grid gap-2 px-4 py-3.5">
									<Skeleton className="h-4 w-1/2" />
									<Skeleton className="h-3 w-3/4 bg-muted/70" />
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
