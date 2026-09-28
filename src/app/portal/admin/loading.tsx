export default function AdminLoading() {
	return (
		<div role="status" aria-label="Loading admin page" className="grid animate-pulse gap-6 motion-reduce:animate-none">
			<span className="sr-only">Loading admin page</span>
			<div className="h-16 rounded-xl border bg-secondary/40" />
			<div className="grid gap-2">
				<div className="h-4 w-28 rounded bg-muted" />
				<div className="h-9 w-64 max-w-full rounded bg-muted" />
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="h-28 rounded-lg border bg-card" />
				))}
			</div>
			<div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
				<div className="h-72 rounded-lg border bg-card" />
				<div className="h-72 rounded-lg border bg-card" />
			</div>
		</div>
	);
}
