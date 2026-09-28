export default function PortalLoading() {
	return (
		<div
			role="status"
			aria-label="Loading page"
			className="grid animate-pulse gap-6 motion-reduce:animate-none"
		>
			<span className="sr-only">Loading page</span>

			<div className="grid gap-2">
				<div className="h-3 w-28 rounded bg-muted" />
				<div className="h-9 w-52 max-w-full rounded bg-muted" />
			</div>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="h-28 rounded-lg border bg-card" />
				))}
			</div>

			<div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
				<div className="h-72 rounded-lg border bg-card" />
				<div className="h-72 rounded-lg border bg-card" />
			</div>
		</div>
	);
}
