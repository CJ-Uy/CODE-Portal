import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PointTypeRow } from "@/db/repositories/pointTypes";
import type { MyHistorySummary, TermOption, TypedRetentionRecord } from "@/db/repositories/retention";
import { formatPoints, quantizePoints } from "@/lib/points";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<MyHistorySummary["status"], string> = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
};

export function RetentionHistory({
	summary,
	records,
	terms,
	selectedTermId,
	selectedPointTypeId,
	pointTypes,
}: {
	summary: MyHistorySummary | null;
	records: TypedRetentionRecord[];
	terms: TermOption[];
	selectedTermId: string;
	selectedPointTypeId: string | null;
	pointTypes: PointTypeRow[];
}) {
	const visibleRecords = selectedPointTypeId ? records.filter((record) => record.pointTypeId === selectedPointTypeId) : records;
	const totals = new Map<string, number>();
	for (const record of records) {
		totals.set(record.pointTypeId, quantizePoints((totals.get(record.pointTypeId) ?? 0) + (record.points ?? 0)));
	}
	const milestoneTypes = pointTypes.filter((type) => (type.milestones?.length ?? 0) > 0);

	return (
		<div className="flex flex-col gap-4">
			<form method="get" className="flex items-center gap-2">
				{selectedPointTypeId ? <input type="hidden" name="pointTypeId" value={selectedPointTypeId} /> : null}
				<label className="text-sm text-muted-foreground" htmlFor="termId">
					Term
				</label>
				<select
					id="termId"
					name="termId"
					defaultValue={selectedTermId}
					className="rounded-md border border-border bg-background px-2 py-1 text-sm"
				>
					{terms.map((term) => (
						<option key={term.id} value={term.id}>
							{term.name}
							{term.isCurrent ? " (current)" : ""}
						</option>
					))}
				</select>
				<button type="submit" className="rounded-md border border-border px-3 py-1 text-sm">
					View
				</button>
			</form>

			{summary ? (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-3">
							<CardTitle>{summary.termName}</CardTitle>
							<Badge variant={summary.status === "probation" ? "warn" : "secondary"}>
								{STATUS_LABEL[summary.status]}
							</Badge>
						</div>
						<CardDescription>
							{formatPoints(summary.totalPoints)} points · retained at {summary.retainedAt} · {summary.recordCount} records
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<p className="text-sm text-muted-foreground">No retention data for this term yet.</p>
			)}

			{milestoneTypes.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Milestone progress</CardTitle>
						<CardDescription>Your points and targets for this term.</CardDescription>
					</CardHeader>
					<CardContent className="divide-y divide-border p-0">
						{milestoneTypes.map((type) => {
							const milestones = type.milestones ?? [];
							const points = totals.get(type.id) ?? 0;
							const next = milestones.find((milestone) => points < milestone.points);
							const target = next?.points ?? milestones.at(-1)?.points ?? 0;
							return (
								<section key={type.id} className="grid gap-3 px-4 py-4">
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<h3 className="min-w-0 break-words font-semibold">{type.label}</h3>
										<span className="shrink-0 font-heading text-xl tabular-nums">
											{formatPoints(points)} points
										</span>
									</div>
									<p className="text-sm text-muted-foreground">
										{next
											? `${formatPoints(next.points - points)} to ${next.title}`
											: "Every milestone reached."}
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
												return (
													<li key={milestone.points} className="flex w-28 shrink-0 flex-col gap-1.5 sm:w-32">
														<div className="flex items-center">
															<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
																<div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
															</div>
															<span
																className={cn(
																	"ml-1 size-3 shrink-0 rounded-full border-2",
																	reached ? "border-primary bg-primary" : "border-border bg-background",
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

			<Card>
				<CardHeader>
					<CardTitle>Records</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{visibleRecords.length === 0 ? (
						<p className="text-sm text-muted-foreground">No records in this term.</p>
					) : (
						visibleRecords.map((record) => (
							<div
								key={record.id}
								className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
							>
								<div className="flex min-w-0 flex-col">
									<span className="break-all text-sm font-medium">{record.reason}</span>
									<span className="text-xs text-muted-foreground">
										{record.recordedAt.toISOString().slice(0, 10)} ·{" "}
										{record.source === "event_attendance" ? "Event" : "Manual"}
									</span>
								</div>
								<span className="min-w-0 break-all text-sm tabular-nums">
									{record.points ?? "n/a"} {record.pointTypeLabel}
								</span>
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}
