"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartBar, ChartNoAxesColumnIncreasing, ChartPie, Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { MyHistoryRecord } from "@/db/repositories/retention";
import { toLocalDate } from "@/lib/date-slots";
import { colourClasses, colourValue } from "@/lib/event-type-colours";
import { formatPoints } from "@/lib/points";
import { buildCategoryTimeline, recordCategory, type RetentionCategory } from "@/lib/retention-categories";
import { cn } from "@/lib/utils";

const VIEWS = [
	{ id: "progress", label: "Progress", icon: ChartBar },
	{ id: "pie", label: "Pie", icon: ChartPie },
	{ id: "race", label: "Bar race", icon: ChartNoAxesColumnIncreasing },
] as const;

function CategoryLabel({ category }: { category: Pick<RetentionCategory, "label" | "colour"> }) {
	const colours = colourClasses(category.colour);
	return <Badge variant="outline" className={cn("max-w-full gap-2 border-transparent text-left", colours.chip)}>
		<span className={cn("size-2 shrink-0 rounded-full", colours.dot)} aria-hidden />
		<span className="min-w-0 break-words">{category.label}</span>
	</Badge>;
}

function displayDate(date: string): string {
	return new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

export function RetentionCategoryProgress({ records, total, goal }: {
	records: MyHistoryRecord[];
	total: number;
	goal: { label: string; points: number } | null;
}) {
	const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("progress");
	const [metric, setMetric] = useState<"points" | "activities">("points");
	const timeline = useMemo(() => buildCategoryTimeline(records), [records]);
	const categories = timeline.at(-1)!.categories;
	const lastFrame = timeline.length - 1;
	const [frame, setFrame] = useState(lastFrame);
	const [playing, setPlaying] = useState(false);
	const running = playing && view === "race" && frame < lastFrame;
	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setFrame((current) => Math.min(lastFrame, current + 1)), 900);
		return () => window.clearInterval(timer);
	}, [running, lastFrame]);

	const snapshot = timeline[frame];
	const rows = categories
		.filter((category) => metric === "points" || category.activities > 0)
		.map((category) => view === "race"
			? snapshot.categories.find((row) => row.key === category.key) ?? { ...category, points: 0, activities: 0 }
			: category)
		.sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label));
	const scale = Math.max(1, ...timeline.flatMap((snapshot) => snapshot.categories.map((row) => row[metric])));
	const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, row[metric]), 0);
	const hasNegative = rows.some((row) => row[metric] < 0);
	const slices = [];
	let offset = 0;
	for (const row of rows) {
		if (row[metric] <= 0) continue;
		const length = row[metric] / positiveTotal * Math.PI * 96;
		slices.push({ ...row, length, offset });
		offset += length;
	}
	const remaining = goal ? Math.max(0, goal.points - total) : 0;
	const targetScale = goal ? Math.max(1, goal.points, total, remaining) : 1;

	return <Card>
		<CardHeader className="gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<CardTitle>Activity breakdown</CardTitle>
					<CardDescription className="mt-1">See which categories contribute to your term.</CardDescription>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">Measure</span>
					<Select aria-label="Measure" className="w-auto" value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>
						<option value="points">Points</option>
						<option value="activities">Activities attended</option>
					</Select>
				</label>
			</div>
			<div className="flex flex-wrap gap-1" role="group" aria-label="Chart view">
				{VIEWS.map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant={view === id ? "secondary" : "ghost"} aria-pressed={view === id} onClick={() => { setPlaying(false); setView(id); }}>
					<Icon aria-hidden />{label}
				</Button>)}
			</div>
		</CardHeader>
		<CardContent className="grid gap-6">
			{view === "progress" && goal ? <div className="grid gap-2 border-b border-border/60 pb-5">
				<div className="flex flex-wrap justify-between gap-1 text-sm">
					<span className="font-semibold">{goal.label} target</span>
					<span className="tabular-nums">{formatPoints(total)} / {formatPoints(goal.points)} points</span>
				</div>
				<div className="flex h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${goal.label} points target`} aria-valuemin={0} aria-valuemax={Math.max(1, goal.points)} aria-valuenow={Math.max(0, Math.min(total, Math.max(1, goal.points)))} aria-valuetext={`${formatPoints(total)} points earned, ${formatPoints(remaining)} remaining`}>
					<span className="h-full bg-accent" style={{ width: `${Math.max(0, total) / targetScale * 100}%` }} />
					<span className="h-full bg-rose-500/35" style={{ width: `${remaining / targetScale * 100}%` }} />
				</div>
				<div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
					<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-accent" aria-hidden />{formatPoints(total)} earned</span>
					<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-rose-500/35" aria-hidden />{formatPoints(remaining)} remaining</span>
				</div>
			</div> : null}

			{rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{metric === "activities" ? "No attended activities recorded for this point type yet." : "Your categories will appear when an activity or manual record is logged."}</p> : view === "pie" ? <div className="grid items-center gap-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
				<div className="relative mx-auto grid size-48 place-items-center">
					<svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90" role="img" aria-label={`Category share of ${formatPoints(positiveTotal)} ${metric === "points" ? "positive points" : "attended activities"}. Values listed alongside.`}>
						<circle cx="60" cy="60" r="48" fill="none" strokeWidth="16" className="stroke-muted" />
						{slices.map((row) => <circle key={row.key} cx="60" cy="60" r="48" fill="none" stroke={colourValue(row.colour)} strokeWidth="16" strokeDasharray={`${row.length} ${Math.PI * 96}`} strokeDashoffset={-row.offset} />)}
					</svg>
					<div className="text-center"><p className="text-3xl font-semibold tabular-nums">{formatPoints(positiveTotal)}</p><p className="mt-1 text-xs text-muted-foreground">{metric === "points" ? "positive points" : "activities attended"}</p></div>
				</div>
				<ul className="divide-y divide-border/50">
					{rows.map((row) => <li key={row.key} className="flex min-w-0 items-center justify-between gap-3 py-3">
						<CategoryLabel category={row} /><span className="shrink-0 text-sm tabular-nums">{formatPoints(row[metric])}<span className="ml-2 text-xs text-muted-foreground">{positiveTotal > 0 ? `${Math.round(Math.max(0, row[metric]) / positiveTotal * 100)}%` : "0%"}</span></span>
					</li>)}
				</ul>
			</div> : <div className="grid gap-4">
				{view === "race" ? <div className="grid gap-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-sm font-semibold tabular-nums" aria-live={running ? "off" : "polite"}>{snapshot.date ? displayDate(snapshot.date) : "Before first record"}</p>
						<div className="flex gap-2">
							<Button type="button" size="sm" variant="secondary" disabled={lastFrame === 0} onClick={() => { if (frame === lastFrame) setFrame(0); setPlaying(!running); }}>{running ? <Pause aria-hidden /> : <Play aria-hidden />}{running ? "Pause" : frame === lastFrame ? "Replay" : "Play"}</Button>
							<Button type="button" size="sm" variant="ghost" disabled={lastFrame === 0} onClick={() => { setPlaying(false); setFrame(0); }}><RotateCcw aria-hidden />Reset</Button>
						</div>
					</div>
					<label className="grid gap-1 text-xs text-muted-foreground">Timeline
						<input type="range" min={0} max={lastFrame} value={frame} disabled={lastFrame === 0} aria-valuetext={snapshot.date ? displayDate(snapshot.date) : "Before first record"} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} className="w-full accent-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" />
					</label>
				</div> : null}
				<ol className="relative" style={{ height: `${rows.length * 76}px` }} aria-label={`${metric === "points" ? "Points" : "Activities attended"} by category`}>
					{rows.map((row, index) => <li key={row.key} className={cn("absolute inset-x-0 top-0 grid h-[76px] content-start gap-2", view === "race" && "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out")} style={{ transform: `translateY(${index * 76}px)` }}>
						<div className="flex min-w-0 items-center justify-between gap-3 text-sm"><CategoryLabel category={row} /><span className="shrink-0 tabular-nums">{formatPoints(row[metric])} {metric === "points" ? "pts" : row.activities === 1 ? "activity" : "activities"}</span></div>
						<div className="h-3 overflow-hidden rounded-sm bg-muted/50"><div className={cn("h-full rounded-sm", colourClasses(row.colour).dot, view === "race" && "motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out")} style={{ width: `${Math.max(0, row[metric]) / scale * 100}%` }} /></div>
					</li>)}
				</ol>
				<p className="text-xs text-muted-foreground">{view === "race" ? "Cumulative progress by recording date. Drag the timeline or replay it." : metric === "activities" ? "Each attended event counts once. Manual records do not count as attendance." : "Points earned in each category. The term target applies to your total."}</p>
			</div>}
			{hasNegative ? <p className="text-xs text-muted-foreground">Chart sizes show positive category totals. Negative adjustments remain in your total and activity history.</p> : null}
		</CardContent>
	</Card>;
}

export function RetentionActivityHistory({ records, typeLabel }: { records: MyHistoryRecord[]; typeLabel: string }) {
	const [category, setCategory] = useState("all");
	const categories = useMemo(() => buildCategoryTimeline(records).at(-1)!.categories.sort((a, b) => a.label.localeCompare(b.label)), [records]);
	const visible = records.filter((record) => category === "all" || recordCategory(record).key === category);
	return <Card>
		<CardHeader className="flex flex-wrap items-start justify-between gap-3 sm:flex-row">
			<div className="min-w-0"><CardTitle>Activity history</CardTitle><CardDescription className="mt-1">{typeLabel} points, newest recorded first. {visible.length} of {records.length} records.</CardDescription></div>
			<label className="grid max-w-full gap-1 text-xs text-muted-foreground">Category
				<Select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} className="w-full sm:w-56">
					<option value="all">All categories</option>
					{categories.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
				</Select>
			</label>
		</CardHeader>
		<CardContent className="p-0">
			{visible.length === 0 ? <p className="px-4 pb-5 text-sm text-muted-foreground">No records in this term. Attended events and manual entries will appear here.</p> : <table className="block w-full text-left text-sm md:table md:table-fixed" role="table">
				<thead className="sr-only bg-muted/40 text-xs text-muted-foreground md:not-sr-only md:table-header-group"><tr><th scope="col" className="w-[18%] px-4 py-3 font-medium">Recorded</th><th scope="col" className="w-[40%] px-4 py-3 font-medium">Activity</th><th scope="col" className="w-[30%] px-4 py-3 font-medium">Category</th><th scope="col" className="w-[12%] px-4 py-3 text-right font-medium">Points</th></tr></thead>
				<tbody className="block divide-y divide-border/50 md:table-row-group" role="rowgroup">
					{visible.map((record) => <tr key={record.id} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-4 md:table-row">
						<td role="cell" className="col-span-2 text-xs text-muted-foreground md:px-4 md:py-4"><time dateTime={record.recordedAt.toISOString()}>{displayDate(toLocalDate(record.recordedAt))}</time></td>
						<td role="cell" className="min-w-0 md:px-4 md:py-4"><p className="break-words font-medium">{record.eventTitle || record.reason}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{record.source === "manual" ? "Manual record" : "Event attendance"}{record.eventTitle && record.reason !== record.eventTitle ? ` · ${record.reason}` : ""}</p></td>
						<td role="cell" className="col-span-2 min-w-0 md:px-4 md:py-4"><CategoryLabel category={recordCategory(record)} /></td>
						<td role="cell" className="col-start-2 row-start-2 text-right font-semibold tabular-nums md:px-4 md:py-4">{record.points === null ? <span className="text-xs font-normal text-muted-foreground">No points</span> : `${record.points > 0 ? "+" : ""}${formatPoints(record.points)}`}</td>
					</tr>)}
				</tbody>
			</table>}
		</CardContent>
	</Card>;
}
