export default function EventDetailLoading() {
	return (
		<div role="status" aria-label="Loading event" className="grid animate-pulse gap-6 motion-reduce:animate-none">
			<span className="sr-only">Loading event</span>
			<div className="h-5 w-32 rounded bg-muted" />
			<div className="h-48 border-b bg-muted/40" />
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="h-80 rounded-lg border bg-card" />
				<div className="h-96 rounded-lg border bg-card" />
			</div>
			<div className="h-64 rounded-lg border bg-card" />
		</div>
	);
}
