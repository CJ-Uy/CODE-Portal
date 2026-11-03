import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the member feedback form: narrow column, header, one card per question. */
export default function SurveyLoading() {
	return (
		<LoadingScreen label="Loading form" className="mx-auto w-full max-w-2xl">
			<div className="grid gap-2">
				<Skeleton className="h-3 w-20" />
				<Skeleton className="h-8 w-72 max-w-full" />
				<Skeleton className="h-4 w-full bg-muted/70" />
				<Skeleton className="h-4 w-2/3 bg-muted/70" />
			</div>
			<div className="grid gap-4">
				{Array.from({ length: 3 }, (_, index) => (
					<div key={index} className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
						<Skeleton className="h-5 w-3/4" />
						<div className="grid grid-cols-5 gap-1.5">
							{Array.from({ length: 5 }, (_, pill) => (
								<Skeleton key={pill} className="h-12 rounded-lg" />
							))}
						</div>
						<div className="flex justify-between">
							<Skeleton className="h-3 w-16 bg-muted/70" />
							<Skeleton className="h-3 w-16 bg-muted/70" />
						</div>
					</div>
				))}
			</div>
		</LoadingScreen>
	);
}
