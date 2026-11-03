import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the Ments Tree: header, search toolbar, then the bordered canvas. */
export default function MentsLoading() {
	return (
		<LoadingScreen label="Loading Ments Tree">
			<div className="grid gap-2">
				<Skeleton className="h-9 w-48" />
				<Skeleton className="h-4 w-full max-w-2xl bg-muted/70" />
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Skeleton className="h-10 basis-full rounded-md sm:max-w-md sm:flex-1" />
				<Skeleton className="h-10 w-24 rounded-md" />
			</div>
			<div className="overflow-hidden rounded-xl border border-border bg-card">
				<div className="h-14 border-b border-border" />
				<div className="h-[24rem] bg-secondary/25 sm:h-[38rem]" />
			</div>
		</LoadingScreen>
	);
}
