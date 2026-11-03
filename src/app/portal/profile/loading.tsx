import { LoadingScreen, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the profile: identity card with banner, points card, then the edit form beside the QR. */
export default function ProfileLoading() {
	return (
		<LoadingScreen label="Loading profile">
			<div className="overflow-hidden rounded-lg border border-border bg-card">
				<div className="h-20 bg-primary" />
				<div className="grid gap-3 px-5 pb-5">
					<Skeleton className="-mt-10 size-20 rounded-full ring-4 ring-card" />
					<Skeleton className="h-7 w-48" />
					<Skeleton className="h-4 w-56 bg-muted/70" />
					<div className="mt-3 grid grid-cols-2 gap-3">
						<Skeleton className="h-20 rounded-xl" />
						<Skeleton className="h-20 rounded-xl" />
					</div>
				</div>
			</div>
			<div className="grid gap-3 rounded-lg border border-border bg-card p-5">
				<Skeleton className="h-5 w-40" />
				{Array.from({ length: 3 }, (_, index) => (
					<div key={index} className="flex justify-between border-t border-border pt-3 first:border-t-0">
						<Skeleton className="h-4 w-28" />
						<Skeleton className="h-6 w-10" />
					</div>
				))}
			</div>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="h-96 rounded-lg border border-border bg-card" />
				<Skeleton className="h-11 w-40 rounded-md" />
			</div>
		</LoadingScreen>
	);
}
