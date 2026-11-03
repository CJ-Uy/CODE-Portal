"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import type { MyHistoryRecord } from "@/db/repositories/retention";
import { toLocalDate } from "@/lib/date-slots";
import { formatPoints } from "@/lib/points";
import { sourceLabel } from "@/lib/retention-categories";
import { cn } from "@/lib/utils";

const FIRST_ROWS = 5;

/** What the row adds beyond its title and source: nothing for a plain check-in, a short note for a split one. */
function recordDetail(record: MyHistoryRecord): string {
	if (record.source === "feedback_share") return "";
	if (!record.eventTitle) return "";
	const attended = `Attended ${record.eventTitle}`;
	if (record.reason === attended) return "";
	if (record.reason.startsWith(`${attended} (75%`)) return "75% at check-in";
	return record.reason;
}

function displayDate(date: string): string {
	return new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

/** Every record behind the numbers, newest first, filterable by point type. Part types read "Retention", the rest "Not counted". */
export function RetentionActivity({ records, partIds }: { records: MyHistoryRecord[]; partIds: string[] }) {
	const [typeId, setTypeId] = useState("all");
	const [showAll, setShowAll] = useState(false);
	const types = Array.from(new Map(records.map((record) => [record.pointTypeId, record.pointTypeLabel])), ([id, label]) => ({ id, label })).sort((a, b) =>
		a.label.localeCompare(b.label),
	);
	const visible = records.filter((record) => typeId === "all" || record.pointTypeId === typeId);
	const parts = new Set(partIds);
	const shown = showAll ? visible : visible.slice(0, FIRST_ROWS);
	return (
		<section aria-labelledby="activity-history" className="grid min-w-0 gap-3">
			<div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<h2 id="activity-history" className="font-heading text-2xl">
						Activity history
					</h2>
					<p className="text-sm text-muted-foreground">Newest first.</p>
				</div>
				<label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
					Point type
					<Select value={typeId} onChange={(event) => setTypeId(event.target.value)} className="w-full min-w-0 sm:w-64">
						<option value="all">All point types</option>
						{types.map((type) => (
							<option key={type.id} value={type.id}>
								{type.label}
							</option>
						))}
					</Select>
				</label>
			</div>
			{visible.length === 0 ? (
				<p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
					No records yet. Checking in at an event or a manual entry from an officer will show up here.
				</p>
			) : (
				<ul className="grid min-w-0 divide-y divide-border/60 rounded-lg border border-border bg-card">
					{shown.map((record) => {
						const counts = parts.has(record.pointTypeId);
						return (
							<li key={record.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
								<time dateTime={record.recordedAt.toISOString()} className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:pt-0.5">
									{displayDate(toLocalDate(record.recordedAt))}
								</time>
								<div className="min-w-0">
									<p className="min-w-0 font-medium [overflow-wrap:anywhere]">{record.eventTitle || record.reason}</p>
									<p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
										<span
											className={cn(
												"rounded-sm px-1.5 py-0.5 font-medium",
												counts ? "bg-secondary text-secondary-foreground" : "border border-dashed border-border",
											)}
										>
											{record.pointTypeLabel}
											{counts ? "" : ", not counted"}
										</span>
										<span className="[overflow-wrap:anywhere]">
											{sourceLabel(record.source)}
											{recordDetail(record) ? ` · ${recordDetail(record)}` : ""}
										</span>
									</p>
								</div>
								<p className="col-start-2 row-start-2 text-right font-semibold tabular-nums sm:col-start-auto sm:row-start-auto">
									{record.points === null ? (
										<span className="text-xs font-normal text-muted-foreground">No points</span>
									) : (
										`${record.points > 0 ? "+" : ""}${formatPoints(record.points)}`
									)}
								</p>
							</li>
						);
					})}
				</ul>
			)}
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
				{visible.length > FIRST_ROWS ? (
					<button
						type="button"
						onClick={() => setShowAll((value) => !value)}
						className="text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{showAll ? "Show fewer" : `Show all ${visible.length}`}
					</button>
				) : (
					<span />
				)}
				<p className="text-xs text-muted-foreground">Something missing? An officer can add it.</p>
			</div>
		</section>
	);
}
