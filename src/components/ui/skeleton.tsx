import { cn } from "@/lib/utils";

/** One placeholder block. Loading screens compose these to the shape of the page on its way. */
export function Skeleton({ className }: { className?: string }) {
	return <div aria-hidden className={cn("animate-pulse rounded bg-muted motion-reduce:animate-none", className)} />;
}

/**
 * The wrapper for a loading.tsx screen: announced once to assistive tech, and eased in so a page
 * that lands within a beat never flashes it (see .loading-enter in globals.css).
 */
export function LoadingScreen({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
	return (
		<div role="status" aria-label={label} className={cn("loading-enter grid min-w-0 gap-6", className)}>
			<span className="sr-only">{label}</span>
			{children}
		</div>
	);
}

/** Eyebrow, title and description, the header most member pages open with. */
export function PageHeaderSkeleton({ eyebrow = false, description = true }: { eyebrow?: boolean; description?: boolean }) {
	return (
		<div className="grid gap-2">
			{eyebrow ? <Skeleton className="h-3 w-28" /> : null}
			<Skeleton className="h-8 w-48 max-w-full" />
			{description ? <Skeleton className="h-4 w-full max-w-md" /> : null}
		</div>
	);
}

/** A bordered card of divided rows: a title line and a detail line each. */
export function RowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
	return (
		<div className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="grid gap-2 px-4 py-3">
					<Skeleton className="h-4 w-2/5" />
					<Skeleton className="h-3 w-3/5 bg-muted/70" />
				</div>
			))}
		</div>
	);
}

/** A neutral page: header and one panel. For pages whose own skeleton has not loaded yet. */
export function PageLoading() {
	return (
		<LoadingScreen label="Loading page">
			<PageHeaderSkeleton />
			<div className="h-96 rounded-lg border border-border bg-card" />
		</LoadingScreen>
	);
}
