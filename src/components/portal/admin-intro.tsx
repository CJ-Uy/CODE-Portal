/**
 * Compact in-context help shown at the top of an admin page or group index.
 * Keep copy to one short paragraph so it never pushes primary controls below the fold.
 */
export function AdminIntro({ title, whoFor, effect }: { title: string; whoFor: string; effect: string }) {
	return (
		<header className="grid gap-2 border-b border-border/60 pb-5">
			<h1 className="text-3xl font-semibold text-primary sm:text-4xl">{title}</h1>
			<p className="max-w-2xl text-base leading-6 text-muted-foreground">{whoFor}.</p>
			<p className="max-w-2xl text-sm leading-5 text-muted-foreground">{effect}.</p>
		</header>
	);
}
