import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Plus } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryItem } from "@/db/repositories/library";
import type { LibraryItemStats, LibraryWeek } from "@/db/repositories/library-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { formatHours } from "@/lib/library/activity";
import { KIND_LABELS, type LibraryStatus } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

const GROUPS: { status: LibraryStatus; title: string }[] = [
	{ status: "draft", title: "Drafts" },
	{ status: "pending_review", title: "Waiting for approval" },
	{ status: "published", title: "Published" },
	{ status: "taken_down", title: "Taken down" },
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
	const live = item.status !== "draft";
	return (
		<li className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4">
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
				<div className="grid min-w-0 gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
						<span className="text-xs text-muted-foreground">Updated {UPDATED.format(item.updatedAt)}</span>
					</div>
					<Link
						href={item.status === "published" ? `/portal/library/${item.id}` : `/portal/library/${item.id}/edit`}
						className="min-w-0 break-all font-heading text-lg leading-snug hover:underline"
					>
						{item.title || "Untitled"}
					</Link>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link href={`/portal/library/${item.id}/edit`}>Edit</Link>
				</Button>
			</div>

			{item.moderationReason && (item.status === "taken_down" || item.status === "draft") ? (
				<p className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
					{item.status === "taken_down" ? "A library moderator took this down: " : "A library moderator sent this back: "}
					{item.moderationReason}
				</p>
			) : null}

			{live ? (
				<div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
					<dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
						<Stat label="Saves" value={String(stats.saves)} />
						<Stat label="Opens" value={String(stats.opens)} />
						<Stat label="Readers" value={String(stats.uniqueReaders)} />
						<Stat label="Reading time" value={formatHours(stats.activeSeconds)} />
						<Stat label="Downloads" value={String(stats.downloads)} />
					</dl>
					{weeks ? <WeeklyBars weeks={weeks} /> : null}
				</div>
			) : null}
		</li>
	);
}

export default async function MyLibraryPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");

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
		<div className="mx-auto grid max-w-4xl gap-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
					<h1 className="font-heading text-3xl">My library</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">Everything you have added, with how it is doing. Only you see these numbers.</p>
				</div>
				<Button asChild>
					<Link href="/portal/library/new">
						<Plus />
						Add to the library
					</Link>
				</Button>
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
				GROUPS.map(({ status, title }) => {
					const group = items.filter((item) => item.status === status);
					if (group.length === 0) return null;
					return (
						<section key={status} className="grid gap-3" aria-labelledby={`mine-${status}`}>
							<h2 id={`mine-${status}`} className="font-heading text-xl">
								{title} <span className="text-base text-muted-foreground">({group.length})</span>
							</h2>
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
