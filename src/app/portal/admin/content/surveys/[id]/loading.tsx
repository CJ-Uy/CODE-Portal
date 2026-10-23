import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors a running form's admin page: header and status, controls card, then result cards. */
export default function SurveyDetailLoading() {
	return (
		<LoadingScreen label="Loading form">
			<div className="grid gap-2 border-b border-border/60 pb-5">
				<Skeleton className="h-9 w-72 max-w-full sm:h-10" />
				<Skeleton className="h-4 w-48 bg-muted/70" />
				<Skeleton className="h-5 w-20 rounded-full" />
			</div>
			<div className="grid gap-4 rounded-xl border border-border/60 bg-card p-5">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-10 w-full max-w-sm rounded-md" />
				<Skeleton className="h-10 w-36 rounded-md" />
			</div>
			<div className="grid gap-5">
				<div className="grid gap-3 rounded-xl border border-border/60 bg-card p-4">
					<Skeleton className="h-5 w-56" />
					<Skeleton className="h-4 w-40 bg-muted/70" />
				</div>
				{Array.from({ length: 3 }, (_, index) => (
					<div key={index} className="grid gap-3 rounded-xl border border-border/60 bg-card p-5">
						<Skeleton className="h-6 w-2/3" />
						<Skeleton className="h-5 w-full rounded-full" />
						<Skeleton className="h-3 w-1/2 bg-muted/70" />
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
