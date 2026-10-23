import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { RetentionActivity } from "@/components/retention-activity";
import { PendingFeedback, RetentionGrid, RetentionVerdict, type NextEvent } from "@/components/retention-parts";
import type { PointTypeRow } from "@/db/repositories/pointTypes";
import type { MyHistoryRecord, MyHistorySummary, PendingShare, TermOption } from "@/db/repositories/retention";
import { formatPoints } from "@/lib/points";
import { pointTotals, type RetentionProgress } from "@/lib/retention-parts";
import { cn } from "@/lib/utils";

function HowItWorks() {
	return (
		<details className="group min-w-0 rounded-lg border border-border bg-card">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				How retention works
				<ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
			</summary>
			<ul className="grid max-w-prose gap-2 px-4 pb-4 text-sm text-muted-foreground">
				<li>Retention has 8 parts. You are retained when every part is met for the school year.</li>
				<li>Training Seminar, Project Team, Advocacy-Related and Engagement Team need 1 point each, any time in the school year.</li>
				<li>General Membership Activity, Human Resources Event, Community Building Team Bonding and Knowledge-Sharing Activity need 1 point in each semester. A 1st-semester slot cannot be made up in the 2nd.</li>
				<li>Points past 1 in a slot are extra. They never count toward retention, but they still count toward milestones.</li>
				<li>When an event has a feedback form, checking in gives 75% of its points. Answering the form gives the other 25%.</li>
				<li>Other point types, like Feedback or eligibility points, are tracked on their own and never count toward retention.</li>
			</ul>
		</details>
	);
}

function OtherPoints({ types, totals }: { types: PointTypeRow[]; totals: Map<string, number> }) {
	const rows = types.filter((type) => !type.retentionPeriod && totals.has(type.id));
	return (
		<section aria-labelledby="other-points" className="grid min-w-0 content-start gap-3">
			<div>
				<h2 id="other-points" className="font-heading text-2xl">
					Not counted toward retention
				</h2>
				<p className="text-sm text-muted-foreground">Points from other activities. They are yours to keep, but no retention part uses them.</p>
			</div>
			{rows.length === 0 ? (
				<p className="rounded-md border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">No other points this school year.</p>
			) : (
				<dl className="grid min-w-0 divide-y divide-border/60 rounded-lg border border-dashed border-border bg-card">
					{rows.map((type) => (
						<div key={type.id} className="flex min-w-0 items-baseline justify-between gap-4 px-4 py-2.5">
							<dt className="min-w-0 text-sm [overflow-wrap:anywhere]">{type.label}</dt>
							<dd className="shrink-0 font-semibold tabular-nums">{formatPoints(totals.get(type.id) ?? 0)}</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}

function Milestones({ types, totals }: { types: PointTypeRow[]; totals: Map<string, number> }) {
	const rows = types.filter((type) => (type.milestones?.length ?? 0) > 0);
	if (rows.length === 0) return null;
	return (
		<section aria-labelledby="milestones" className="grid min-w-0 content-start gap-3">
			<div>
				<h2 id="milestones" className="font-heading text-2xl">
					Milestones
				</h2>
				<p className="text-sm text-muted-foreground">Every point of a type this school year counts here, extra points included.</p>
			</div>
			<ul className="grid min-w-0 divide-y divide-border/60 rounded-lg border border-border bg-card">
				{rows.map((type) => {
					const milestones = type.milestones ?? [];
					const points = totals.get(type.id) ?? 0;
					const scale = Math.max(points, milestones.at(-1)?.points ?? 1);
					const next = milestones.find((milestone) => points < milestone.points);
					return (
						<li key={type.id} className="grid min-w-0 gap-3 px-4 py-3.5">
							<div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
								<h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{type.label}</h3>
								<p className="text-sm tabular-nums">
									<span className="font-semibold">{formatPoints(points)}</span>
									<span className="text-muted-foreground"> {next ? `· ${formatPoints(next.points - points)} to ${next.title}` : "· every milestone reached"}</span>
								</p>
							</div>
							<div
								className="relative mx-1.5 h-1.5 rounded-full bg-secondary"
								role="meter"
								aria-label={`${type.label} milestones`}
								aria-valuemin={0}
								aria-valuemax={scale}
								aria-valuenow={Math.max(0, Math.min(points, scale))}
								aria-valuetext={`${formatPoints(points)} points${next ? `, next milestone ${next.title} at ${next.points}` : ""}`}
							>
								<div className="h-full rounded-full bg-accent" style={{ width: `${(Math.max(0, Math.min(points, scale)) / scale) * 100}%` }} />
								{milestones.map((milestone) => (
									<span
										key={milestone.points}
										className={cn(
											"absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ring-2 ring-card",
											points >= milestone.points ? "border-accent bg-accent" : "border-border bg-card",
										)}
										style={{ left: `${(milestone.points / scale) * 100}%` }}
										aria-hidden
									/>
								))}
							</div>
							<ol className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
								{milestones.map((milestone) => {
									const reached = points >= milestone.points;
									return (
										<li key={milestone.points} className={cn("flex min-w-0 items-center gap-1", reached ? "font-medium" : "text-muted-foreground")} title={milestone.description || undefined}>
											{reached ? <Check className="size-3.5 shrink-0 text-accent" aria-label="Reached" /> : null}
											<span className="tabular-nums">{milestone.points}</span>
											<span className="min-w-0 [overflow-wrap:anywhere]">{milestone.title}</span>
										</li>
									);
								})}
							</ol>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

export function RetentionHistory({
	summary,
	records,
	pendingShares,
	progress,
	terms,
	selectedTermId,
	pointTypes,
	nextEvents,
}: {
	summary: MyHistorySummary | null;
	records: MyHistoryRecord[];
	pendingShares: PendingShare[];
	progress: RetentionProgress | null;
	terms: TermOption[];
	selectedTermId: string;
	pointTypes: PointTypeRow[];
	nextEvents: Map<string, NextEvent>;
}) {
	const totals = pointTotals(records);
	const ordered = [...pointTypes].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
				{summary && progress ? (
					<div className="min-w-0">
						<p className="mb-2 text-sm text-muted-foreground">{summary.termName}</p>
						<RetentionVerdict progress={progress} />
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No school year is set up for this date yet. Officers add school years in Admin.</p>
				)}
				{terms.length > 1 ? (
					<form method="get" className="flex min-w-0 flex-wrap items-end gap-2">
						<label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
							School year
							<Select name="termId" defaultValue={selectedTermId} className="w-auto min-w-0 max-w-full">
								{terms.map((term) => (
									<option key={term.id} value={term.id}>
										{term.name}
										{term.isCurrent ? " (current)" : ""}
									</option>
								))}
							</Select>
						</label>
						<Button type="submit" variant="secondary">
							View
						</Button>
					</form>
				) : null}
			</div>

			<PendingFeedback shares={pendingShares} />

			{progress && progress.required > 0 ? (
				<section aria-labelledby="requirements" className="grid min-w-0 gap-3">
					<div className="min-w-0">
						<h2 id="requirements" className="font-heading text-2xl">
							Retention requirements
						</h2>
						<p className="text-sm text-muted-foreground">Each box needs 1 point. Points from the matching events land in the box for the semester the event was in.</p>
					</div>
					<RetentionGrid progress={progress} nextEvents={nextEvents} />
					<HowItWorks />
				</section>
			) : summary ? (
				<HowItWorks />
			) : null}

			{summary ? (
				<div className="grid min-w-0 gap-6 lg:grid-cols-2">
					<OtherPoints types={ordered} totals={totals} />
					<Milestones types={ordered} totals={totals} />
				</div>
			) : null}

			{summary ? <RetentionActivity records={records} partIds={ordered.filter((type) => type.retentionPeriod).map((type) => type.id)} /> : null}
		</div>
	);
}
