import { CalendarClock, Filter, Flame, Medal, Sparkles, Ticket, TrendingUp, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { RetentionActivityHistory, RetentionCategoryProgress } from "@/components/retention-category-progress";
import { CumulativeChart, ProgressRing, WeeklyBars, type ChartLine } from "@/components/retention-charts";
import type { PointTypeRow } from "@/db/repositories/pointTypes";
import type { MyHistoryRecord, MyHistorySummary, TermOption } from "@/db/repositories/retention";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import { formatPoints } from "@/lib/points";
import { buildRetentionStats, neededPerWeek, projectedDateFor, type RetentionStats } from "@/lib/retention-stats";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<MyHistorySummary["status"], string> = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
};

function shortDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

type Goal = { label: string; points: number };

/** One sentence on pace, in the "you'll reach X by <date>" voice goal trackers use. */
function paceSentence(stats: RetentionStats, goal: Goal, endsAt: Date, now: Date): string {
	if (stats.total >= goal.points) return `You've reached ${goal.label}.`;
	if (stats.daysLeft === 0) return "This term has ended.";
	const eta = projectedDateFor(stats, goal.points, now);
	if (eta && eta <= endsAt) return `On pace to reach ${goal.label} around ${shortDate(eta)}.`;
	const needed = neededPerWeek(stats, goal.points);
	return stats.pacePerDay > 0
		? `At this pace you'd end near ${formatPoints(stats.projectedTotal)}. Aim for ${formatPoints(needed)} a week to make it.`
		: `Earn about ${formatPoints(needed)} a week from here to make it.`;
}

function StatTile({ icon: Icon, label, value, hint }: { icon: typeof Trophy; label: string; value: string; hint?: string }) {
	return (
		<div className="min-w-0 rounded-lg border border-border bg-card p-3">
			<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="size-3.5 shrink-0" aria-hidden />
				<span className="truncate">{label}</span>
			</p>
			<p className="mt-1 font-heading text-2xl tabular-nums leading-tight">{value}</p>
			{hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

export function RetentionHistory({
	summary,
	records,
	terms,
	selectedTermId,
	selectedPointTypeId,
	pointTypes,
	now,
	rank,
}: {
	summary: MyHistorySummary | null;
	records: MyHistoryRecord[];
	terms: TermOption[];
	selectedTermId: string;
	selectedPointTypeId: string | null;
	pointTypes: PointTypeRow[];
	now: Date;
	rank: { rank: number; of: number } | null;
}) {
	const typeId = selectedPointTypeId ?? RETENTION_POINT_TYPE_ID;
	const selectedType = pointTypes.find((type) => type.id === typeId);
	const typeLabel = selectedType?.label ?? "Retention";
	const isRetention = typeId === RETENTION_POINT_TYPE_ID;
	const visibleRecords = records.filter((record) => record.pointTypeId === typeId);
	const milestoneTypes = pointTypes.filter((type) => (type.milestones?.length ?? 0) > 0);

	const statsFor = (pointTypeId: string) =>
		summary ? buildRetentionStats(records.filter((record) => record.pointTypeId === pointTypeId), summary, now) : null;
	const stats = statsFor(typeId);

	const milestones = selectedType?.milestones ?? [];
	const goal: Goal | null = isRetention && summary
		? { label: "Retained", points: summary.retainedAt }
		: (() => {
				const next = milestones.find((milestone) => (stats?.total ?? 0) < milestone.points) ?? milestones.at(-1);
				return next ? { label: next.title, points: next.points } : null;
			})();

	const lines: ChartLine[] = [];
	if (summary && stats) {
		if (isRetention) {
			if (summary.probationBelow > 0) lines.push({ label: "Probation below", points: summary.probationBelow, tone: "warn" });
			lines.push({ label: "Retained", points: summary.retainedAt, tone: "goal" });
		}
		// Only milestones already passed plus the next one: a 500-point milestone on the
		// axis would flatten a 12-point term into a line along the floor.
		const ceiling = Math.max(goal?.points ?? 0, stats.projectedTotal, stats.total);
		for (const milestone of milestones) {
			if (milestone.points > ceiling || lines.some((line) => line.points === milestone.points)) continue;
			lines.push({ label: milestone.title, points: milestone.points, tone: goal?.points === milestone.points ? "goal" : "milestone" });
		}
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<form method="get" className="flex flex-wrap items-center gap-2">
				{selectedPointTypeId ? <input type="hidden" name="pointTypeId" value={selectedPointTypeId} /> : null}
				<label className="text-sm text-muted-foreground" htmlFor="termId">
					Term
				</label>
				<Select
					id="termId"
					name="termId"
					defaultValue={selectedTermId}
					className="min-w-0 w-auto max-w-full"
				>
					{terms.map((term) => (
						<option key={term.id} value={term.id}>
							{term.name}
							{term.isCurrent ? " (current)" : ""}
						</option>
					))}
				</Select>
				<Button type="submit" variant="secondary">
					<Filter aria-hidden />
					View
				</Button>
			</form>

			{summary && stats ? (
				<>
					<Card className="overflow-hidden">
						<CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
							{goal ? <ProgressRing value={stats.total} max={goal.points} className="self-center" /> : null}
							<div className="grid min-w-0 flex-1 gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<p className="text-xs font-semibold uppercase text-muted-foreground">{summary.termName}</p>
									{isRetention ? (
										<Badge variant={summary.status === "probation" ? "warn" : summary.status === "retained" ? "success" : "secondary"}>
											{STATUS_LABEL[summary.status]}
										</Badge>
									) : null}
								</div>
								<p className="min-w-0 break-words font-heading text-4xl tabular-nums leading-none">
									{formatPoints(stats.total)}
									<span className="ml-2 text-base font-normal text-muted-foreground">{typeLabel} points</span>
								</p>
								{goal ? (
									<>
										<p className="text-sm">
											{stats.total >= goal.points ? (
												<span className="font-semibold">Target reached: {goal.label}</span>
											) : (
												<>
													<span className="font-semibold tabular-nums">{formatPoints(goal.points - stats.total)} to go</span>{" "}
													<span className="text-muted-foreground">to {goal.label} ({formatPoints(goal.points)})</span>
												</>
											)}
										</p>
										<p className="text-sm text-muted-foreground">{paceSentence(stats, goal, summary.endsAt, now)}</p>
									</>
								) : (
									<p className="text-sm text-muted-foreground">No targets set for this point type.</p>
								)}
								{/* Qantas-style deadline bar: how much of the term is already spent. */}
								<div className="mt-1 grid gap-1">
									<div className="h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-foreground/40"
											style={{ width: `${Math.min(100, (stats.elapsedDays / Math.max(1, stats.totalDays)) * 100)}%` }}
										/>
									</div>
									<div className="flex justify-between text-[11px] text-muted-foreground">
										<span>{shortDate(summary.startsAt)}</span>
										<span className="font-medium text-foreground">
											{stats.daysLeft > 0 ? `${stats.daysLeft} days left` : "Term over"}
										</span>
										<span>{shortDate(summary.endsAt)}</span>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>

					<RetentionCategoryProgress key={`progress:${summary.termId}:${typeId}`} records={visibleRecords} total={stats.total} goal={goal} />

					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
						<StatTile icon={Sparkles} label="Points" value={formatPoints(stats.total)} hint={typeLabel} />
						<StatTile icon={Ticket} label="Events" value={String(stats.events)} hint={`${visibleRecords.length} records`} />
						<StatTile icon={TrendingUp} label="Avg per week" value={formatPoints(stats.weeklyAverage)} />
						<StatTile icon={Medal} label="Best week" value={formatPoints(stats.bestWeek)} />
						<StatTile icon={Flame} label="Week streak" value={String(stats.streak)} hint={stats.streak === 1 ? "week" : "weeks in a row"} />
						{rank ? (
							<StatTile icon={Trophy} label="Rank" value={`#${rank.rank}`} hint={`of ${rank.of} ranked`} />
						) : (
							<StatTile icon={CalendarClock} label="Days left" value={String(stats.daysLeft)} hint="in this term" />
						)}
					</div>

					<RetentionActivityHistory key={`history:${selectedTermId}:${typeId}`} records={visibleRecords} typeLabel={typeLabel} />

					<Card>
						<CardHeader>
							<CardTitle>Progress this term</CardTitle>
							<CardDescription>Running total, your targets, and where your current pace lands by {shortDate(summary.endsAt)}.</CardDescription>
						</CardHeader>
						<CardContent>
							<CumulativeChart stats={stats} startsAt={summary.startsAt} endsAt={summary.endsAt} now={now} lines={lines} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Points by week</CardTitle>
							<CardDescription>One bar per week of term. The dark bar is this week.</CardDescription>
						</CardHeader>
						<CardContent>
							<WeeklyBars stats={stats} />
						</CardContent>
					</Card>
				</>
			) : (
				<p className="text-sm text-muted-foreground">No retention data for this term yet.</p>
			)}

			{milestoneTypes.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Milestone progress</CardTitle>
						<CardDescription>Your points and targets for this term, with an estimate at your current pace.</CardDescription>
					</CardHeader>
					<CardContent className="divide-y divide-border p-0">
						{milestoneTypes.map((type) => {
							const milestones = type.milestones ?? [];
							const typeStats = statsFor(type.id);
							const points = typeStats?.total ?? 0;
							const next = milestones.find((milestone) => points < milestone.points);
							const target = next?.points ?? milestones.at(-1)?.points ?? 0;
							const reachedCount = milestones.filter((milestone) => points >= milestone.points).length;
							return (
								<section key={type.id} className="grid gap-3 px-4 py-4">
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<h3 className="min-w-0 break-words font-semibold">{type.label}</h3>
										<span className="shrink-0 font-heading text-xl tabular-nums">
											{formatPoints(points)} points
										</span>
									</div>
									<p className="text-sm text-muted-foreground">
										<span className="font-medium text-foreground">
											{reachedCount} of {milestones.length} reached.
										</span>{" "}
										{next ? `${formatPoints(next.points - points)} to ${next.title}.` : "Every milestone reached."}
									</p>
									{/* The rail scrolls rather than compressing: a point type may carry up to 20
									    milestones, and squeezing them would make every label unreadable. */}
									<div
										role="progressbar"
										aria-label={`${type.label} milestone progress`}
										aria-valuemin={0}
										aria-valuemax={target}
										aria-valuenow={Math.max(0, Math.min(points, target))}
										aria-valuetext={`${formatPoints(points)} of ${target} points`}
										className="overflow-x-auto pb-1"
									>
										<ol className="flex min-w-max items-start">
											{milestones.map((milestone, index) => {
												const floor = index === 0 ? 0 : milestones[index - 1].points;
												const span = milestone.points - floor;
												const reached = points >= milestone.points;
												// Each segment fills only for its own span, so the rail shows progress
												// through the current tier instead of one bar against the final target.
												const fill = reached
													? 100
													: span <= 0
														? 0
														: Math.max(0, Math.min(100, ((points - floor) / span) * 100));
												const eta = !reached && typeStats && summary ? projectedDateFor(typeStats, milestone.points, now) : null;
												const etaInTerm = eta && summary && eta <= summary.endsAt;
												return (
													<li key={milestone.points} className="flex w-32 shrink-0 flex-col gap-1.5 sm:w-36">
														<div className="flex items-center">
															<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
																<div className="h-full rounded-full bg-accent" style={{ width: `${fill}%` }} />
															</div>
															<span
																className={cn(
																	"ml-1 size-3 shrink-0 rounded-full border-2",
																	reached ? "border-accent bg-accent" : "border-border bg-background",
																)}
															/>
														</div>
														<div className="pr-1 text-right">
															<p className="text-xs font-semibold tabular-nums">
																{milestone.points} pts {reached ? "✓" : ""}
															</p>
															<p
																className={cn(
																	"min-w-0 break-words text-xs",
																	reached ? "font-medium" : "text-muted-foreground",
																)}
															>
																{milestone.title}
															</p>
															{milestone.description ? (
																<p className="mt-0.5 min-w-0 break-words text-[11px] text-muted-foreground">
																	{milestone.description}
																</p>
															) : null}
															{!reached ? (
																<p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
																	{formatPoints(milestone.points - points)} to go
																	{etaInTerm ? ` · ~${shortDate(eta)}` : eta ? " · after term" : ""}
																</p>
															) : null}
														</div>
													</li>
												);
											})}
										</ol>
									</div>
								</section>
							);
						})}
					</CardContent>
				</Card>
			) : null}

			{!summary || !stats ? <RetentionActivityHistory key={`history:${selectedTermId}:${typeId}`} records={visibleRecords} typeLabel={typeLabel} /> : null}
		</div>
	);
}
