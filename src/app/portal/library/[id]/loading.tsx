import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors a library item: back link, badges, title and dek, actions, then the body. */
export default function LibraryItemLoading() {
	return (
		<LoadingScreen label="Loading library item" className="mx-auto max-w-4xl">
			<Skeleton className="h-4 w-28" />
			<div className="grid gap-3">
				<div className="flex gap-2">
					<Skeleton className="h-5 w-20 rounded-full" />
					<Skeleton className="h-5 w-24 rounded-full" />
				</div>
				<Skeleton className="h-9 w-4/5" />
				<Skeleton className="h-5 w-full max-w-2xl bg-muted/70" />
				<Skeleton className="h-4 w-56" />
				<div className="flex flex-wrap gap-2 pt-1">
					{Array.from({ length: 3 }, (_, index) => (
						<Skeleton key={index} className="h-10 w-24 rounded-md" />
					))}
				</div>
			</div>
			<div className="h-[26rem] rounded-xl border border-border bg-card" />
		</LoadingScreen>
	);
}
