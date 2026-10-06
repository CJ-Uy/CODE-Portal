import type { RetentionStats } from "@/lib/retention-stats";
import { formatPoints } from "@/lib/points";
import { cn } from "@/lib/utils";

const MANILA = "Asia/Manila";

function shortDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: MANILA });
}

/** Ring gauge in the loyalty-tier style: one number, one target, nothing else to read. */
export function ProgressRing({ value, max, className }: { value: number; max: number; className?: string }) {
	const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
	const radius = 52;
	const circumference = 2 * Math.PI * radius;
	return (
		<div className={cn("relative grid size-32 shrink-0 place-items-center", className)}>
			<svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
				<circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
				<circle
					cx="60"
					cy="60"
					r={radius}
					fill="none"
					strokeWidth="10"
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - ratio)}
					className="stroke-accent"
				/>
			</svg>
			<div className="text-center">
				<p className="font-heading text-3xl tabular-nums leading-none">{Math.round(ratio * 100)}%</p>
				<p className="mt-1 text-[11px] text-muted-foreground">of target</p>
			</div>
		</div>
	);
}

function niceStep(value: number): number {
	const magnitude = 10 ** Math.floor(Math.log10(value));
	return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((multiple) => multiple * magnitude >= value) ?? 10) * magnitude;
}

export type ChartLine = { label: string; points: number; tone: "goal" | "warn" | "milestone" };

/**
 * Lines live in a stretched 0-100 SVG (non-scaling strokes) and every label is HTML
 * positioned by percentage. A fixed-viewBox chart would shrink its text to ~6px on a
 * phone; this keeps labels at real font sizes at every width.
 */
export function CumulativeChart({
	stats,
	startsAt,
	endsAt,
	now,
	lines,
}: {
	stats: RetentionStats;
	startsAt: Date;
	endsAt: Date;
	now: Date;
	lines: ChartLine[];
}) {
	const start = startsAt.getTime();
	const end = Math.max(start + 1, endsAt.getTime());
	const clock = Math.min(Math.max(now.getTime(), start), end);
	const projecting = stats.daysLeft > 0 && stats.total > 0;
	// Two gridlines on round numbers (5/10, 15/30, 25/50...) read faster than 11/23.
	const step = niceStep(Math.max(1, stats.total, projecting ? stats.projectedTotal : 0, ...lines.map((line) => line.points)) * 0.55);
	const yMax = step * 2;
	const x = (time: number) => ((Math.min(Math.max(time, start), end) - start) / (end - start)) * 100;
	const y = (points: number) => 100 - (points / yMax) * 100;

	let path = `M0,${y(0)}`;
	for (const point of stats.cumulative) path += ` H${x(point.at.getTime()).toFixed(2)} V${y(point.total).toFixed(2)}`;
	path += ` H${x(clock).toFixed(2)}`;
	const area = `${path} V100 H0 Z`;

	const months: Array<{ left: number; label: string }> = [];
	const cursor = new Date(startsAt);
	cursor.setUTCDate(1);
	cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	while (cursor.getTime() < end) {
		months.push({ left: x(cursor.getTime()), label: cursor.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}

	const toneClass: Record<ChartLine["tone"], string> = {
		goal: "stroke-accent",
		warn: "stroke-muted-foreground",
		milestone: "stroke-border",
	};

	return (
		<figure
			role="img"
			aria-label={`Cumulative points: ${formatPoints(stats.total)} so far${projecting ? `, about ${formatPoints(stats.projectedTotal)} by term end at this pace` : ""}.`}
			className="grid gap-2"
		>
			<div className="relative ml-8 h-56 sm:h-64">
				{[0, step, yMax].map((tick) => (
					<span
						key={tick}
						className="absolute -left-8 w-7 -translate-y-1/2 text-right text-[11px] tabular-nums text-muted-foreground"
						style={{ top: `${y(tick)}%` }}
					>
						{tick}
					</span>
				))}
				<svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
					{[0, step, yMax].map((tick) => (
						<line key={tick} x1="0" x2="100" y1={y(tick)} y2={y(tick)} className="stroke-border/50" strokeWidth="1" vectorEffect="non-scaling-stroke" />
					))}
					{lines.map((line) => (
						<line
							key={`${line.label}-${line.points}`}
							x1="0"
							x2="100"
							y1={y(line.points)}
							y2={y(line.points)}
							strokeWidth={line.tone === "goal" ? 2 : 1}
							strokeDasharray="4 4"
							vectorEffect="non-scaling-stroke"
							className={toneClass[line.tone]}
						/>
					))}
					<path d={area} className="fill-accent/15" />
					<path d={path} fill="none" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-accent" />
					{projecting ? (
						<line
							x1={x(clock)}
							y1={y(stats.total)}
							x2="100"
							y2={y(stats.projectedTotal)}
							strokeWidth="2"
							strokeDasharray="2 5"
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
							className="stroke-accent/70"
						/>
					) : null}
					<line x1={x(clock)} x2={x(clock)} y1="0" y2="100" strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-foreground/30" />
				</svg>
				{lines.map((line) => (
					<span
						key={`${line.label}-${line.points}-label`}
						className={cn(
							"absolute right-0 max-w-[60%] -translate-y-full truncate rounded bg-card/85 px-1 text-[11px]",
							line.tone === "goal" ? "font-semibold text-accent" : "text-muted-foreground",
						)}
						style={{ top: `${y(line.points)}%` }}
					>
						{line.label} · {formatPoints(line.points)}
					</span>
				))}
				<span
					className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent shadow"
					style={{ left: `${x(clock)}%`, top: `${y(stats.total)}%` }}
				/>
				{projecting ? (
					<span
						className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-card"
						style={{ left: "100%", top: `${y(stats.projectedTotal)}%` }}
						title={`Projected ${formatPoints(stats.projectedTotal)} points by ${shortDate(endsAt)}`}
					/>
				) : null}
			</div>
			<div className="relative ml-8 h-4 text-[11px] text-muted-foreground">
				{months.map((month) => (
					<span key={month.label + month.left} className="absolute -translate-x-1/2" style={{ left: `${month.left}%` }}>
						{month.label}
					</span>
				))}
				<span className="absolute -translate-x-1/2 font-semibold text-foreground" style={{ left: `${x(clock)}%`, top: "100%" }}>
					Today
				</span>
			</div>
			<figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-accent" />Your points</span>
				{projecting ? (
					<span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-accent/70" />At your current pace</span>
				) : null}
				{lines.length ? (
					<span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-muted-foreground" />Targets</span>
				) : null}
			</figcaption>
		</figure>
	);
}

/** Plain flex bars: no geometry to scale, so HTML beats SVG here. */
export function WeeklyBars({ stats }: { stats: RetentionStats }) {
	const max = Math.max(1, stats.bestWeek, stats.weeklyAverage);
	const labelEvery = stats.weeks.length > 10 ? 2 : 1;
	return (
		<div className="grid gap-2">
			<div className="relative flex h-36 items-end gap-1 sm:gap-1.5">
				{stats.weeklyAverage > 0 ? (
					<div
						className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/60"
						style={{ bottom: `${(stats.weeklyAverage / max) * 100}%` }}
					>
						<span className="absolute right-0 -translate-y-full bg-card px-1 text-[11px] text-muted-foreground">
							avg {formatPoints(stats.weeklyAverage)}
						</span>
					</div>
				) : null}
				{stats.weeks.map((week) => {
					const current = !week.future && (stats.weeks[week.index + 1]?.future ?? true);
					return (
						<div
							key={week.index}
							title={`Week ${week.index + 1} (from ${shortDate(week.startsAt)}): ${formatPoints(week.points)} points`}
							className="flex h-full min-w-0 flex-1 flex-col justify-end"
						>
							<div
								className={cn(
									"w-full rounded-t-sm",
									week.future
										? "h-1 border border-dashed border-border bg-transparent"
										: current
											? "bg-accent"
											: "bg-accent/45",
									!week.future && week.points === 0 && "h-1 bg-muted",
								)}
								style={week.future || week.points === 0 ? undefined : { height: `${Math.max(4, (week.points / max) * 100)}%` }}
							/>
						</div>
					);
				})}
			</div>
			<div className="flex gap-1 text-[10px] text-muted-foreground sm:gap-1.5">
				{stats.weeks.map((week) => (
					<span key={week.index} className="min-w-0 flex-1 text-center tabular-nums">
						{week.index % labelEvery === 0 ? `W${week.index + 1}` : ""}
					</span>
				))}
			</div>
		</div>
	);
}
