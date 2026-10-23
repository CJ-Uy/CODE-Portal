import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { BookOpen } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryItem } from "@/db/repositories/library";
import type { LibraryItemStats, LibraryWeek } from "@/db/repositories/library-activity";
import { LibraryHeader } from "@/components/library/library-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { formatHours } from "@/lib/library/activity";
import { KIND_LABELS, type LibraryStatus } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

// Each state says what it means for the member, so nobody has to guess who can see what.
const GROUPS: { status: LibraryStatus; title: string; hint: string }[] = [
	{ status: "draft", title: "Drafts", hint: "Only you and the library moderators can see these until you publish them." },
	{ status: "pending_review", title: "Waiting for approval", hint: "A library moderator checks these before members can see them." },
	{ status: "published", title: "Published", hint: "Every member can find these in the library." },
	{ status: "taken_down", title: "Taken down", hint: "Hidden from members until a library moderator restores them." },
];

const UPDATED = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" });

/** Twelve bars, one per week, oldest first. Plain SVG: it is a glance, not a chart to read values from. */
function WeeklyBars({ weeks }: { weeks: LibraryWeek[] }) {
	const peak = Math.max(1, ...weeks.map((week) => week.opens));
	const width = 8;
	const gap = 3;
	const height = 32;
	const opens = weeks.reduce((sum, week) => sum + week.opens, 0);
	return (
		<figure className="grid gap-1">
			<svg
				role="img"
				aria-label={`Opens per week over the last ${weeks.length} weeks, oldest first: ${weeks.map((week) => week.opens).join(", ")}`}
				viewBox={`0 0 ${weeks.length * (width + gap) - gap} ${height}`}
				className="h-8 w-full max-w-40 text-accent"
				preserveAspectRatio="none"
			>
				{weeks.map((week, index) => {
					// Quiet weeks keep a 1px stub so the row of bars still reads as twelve weeks.
					const barHeight = week.opens === 0 ? 1 : Math.max(3, Math.round((week.opens / peak) * height));
					return <rect key={week.week} x={index * (width + gap)} y={height - barHeight} width={width} height={barHeight} rx={1.5} fill="currentColor" opacity={week.opens === 0 ? 0.3 : 1} />;
				})}
			</svg>
			<figcaption className="text-xs text-muted-foreground">
				{opens} {opens === 1 ? "open" : "opens"} in 12 weeks
			</figcaption>
		</figure>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-sm font-medium tabular-nums">{value}</dd>
		</div>
	);
}

function ItemRow({ item, stats, weeks }: { item: LibraryItem; stats: LibraryItemStats; weeks: LibraryWeek[] | null }) {
	// Numbers only where there can be some: a published item, or one that was published before it went back for a check.
	const showStats = item.status === "published" || (item.status !== "draft" && stats.opens + stats.saves > 0);
	const published = item.status === "published";
	return (
		// The actions sit top right on a wide screen and last on a phone, so every row reads title, note, numbers, then what to do.
		<li className="relative grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4">
			<div className="grid min-w-0 gap-1 sm:pr-56">
				<p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
					<span className="font-medium text-foreground">{KIND_LABELS[item.kind]}</span>
					<span aria-hidden>·</span>
					<span>Updated {UPDATED.format(item.updatedAt)}</span>
				</p>
				<Link
					href={published ? `/portal/library/${item.id}` : `/portal/library/${item.id}/edit`}
					className="min-w-0 [overflow-wrap:anywhere] font-heading text-lg leading-snug hover:underline"
				>
					{item.title || "Untitled"}
				</Link>
			</div>
			<div className="order-last flex flex-wrap gap-2 sm:absolute sm:right-4 sm:top-4 sm:order-none">
				{published ? (
					<Button asChild variant="ghost" size="sm" className="min-h-9">
						<Link href={`/portal/library/${item.id}`}>View</Link>
					</Button>
				) : null}
				<Button asChild variant="outline" size="sm" className="min-h-9">
					<Link href={`/portal/library/${item.id}/edit`}>{item.status === "draft" ? "Continue editing" : "Edit"}</Link>
				</Button>
			</div>

			{item.moderationReason && (item.status === "taken_down" || item.status === "draft") ? (
				<p className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">
					{item.status === "taken_down" ? "A library moderator took this down: " : "A library moderator sent this back: "}
					{item.moderationReason}
				</p>
			) : null}

			{showStats ? (
				<div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
					<dl className="grid min-w-0 grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-5">
						<Stat label="Saves" value={String(stats.saves)} />
						<Stat label="Opens" value={String(stats.opens)} />
						<Stat label="Readers" value={String(stats.uniqueReaders)} />
						<Stat label="Reading time" value={formatHours(stats.activeSeconds)} />
						<Stat label="Downloads" value={String(stats.downloads)} />
					</dl>
					{weeks ? <WeeklyBars weeks={weeks} /> : <p className="text-xs text-muted-foreground">No reads yet</p>}
				</div>
			) : null}
		</li>
	);
}

export default async function MyLibraryPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const repositories = await getRepositories();
	const items = await repositories.library.listMine(actor).catch(() => []);
	const stats = await repositories.libraryActivity.statsFor(items.map((item) => item.id)).catch(() => new Map<string, LibraryItemStats>());
	// A weekly row is one query per item, so only items somebody has opened get one.
	const weekly = new Map<string, LibraryWeek[]>(
		(
			await Promise.all(
				items
					.filter((item) => item.status !== "draft" && (stats.get(item.id)?.opens ?? 0) > 0)
					.map(async (item) => [item.id, await repositories.libraryActivity.weeklyForOwner(actor, item.id).catch(() => null)] as const),
			)
		).flatMap(([id, weeks]) => (weeks ? [[id, weeks] as const] : [])),
	);
	const zero: LibraryItemStats = { saves: 0, opens: 0, uniqueReaders: 0, activeSeconds: 0, downloads: 0 };

	return (
		<div className="mx-auto grid min-w-0 max-w-6xl gap-6">
			<div className="grid min-w-0 gap-4">
				<LibraryHeader current="mine" />
				<p className="max-w-[65ch] text-sm text-muted-foreground">Everything you have added, and how each published item is doing. The weekly chart and download counts are only for you.</p>
			</div>

			{items.length === 0 ? (
				<EmptyState
					icon={BookOpen}
					title="Nothing here yet"
					description="Upload a file, write a page or share a link. It stays a draft until you publish it."
					action={
						<Button asChild>
							<Link href="/portal/library/new">Add to the library</Link>
						</Button>
					}
				/>
			) : (
				GROUPS.map(({ status, title, hint }) => {
					const group = items.filter((item) => item.status === status);
					if (group.length === 0) return null;
					return (
						<section key={status} className="grid gap-3" aria-labelledby={`mine-${status}`}>
							<div className="grid gap-0.5">
								<h2 id={`mine-${status}`} className="font-heading text-xl">
									{title} <span className="text-base text-muted-foreground">({group.length})</span>
								</h2>
								<p className="text-sm text-muted-foreground">{hint}</p>
							</div>
							<ul className="grid gap-3">
								{group.map((item) => (
									<ItemRow key={item.id} item={item} stats={stats.get(item.id) ?? zero} weeks={weekly.get(item.id) ?? null} />
								))}
							</ul>
						</section>
					);
				})
			)}
		</div>
	);
}
