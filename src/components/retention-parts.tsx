import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import type { PendingShare } from "@/db/repositories/retention";
import { formatPoints } from "@/lib/points";
import type { RetentionPart, RetentionProgress, RetentionSlot, RetentionStatus } from "@/lib/retention-parts";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<RetentionStatus, string> = {
	retained: "Retained",
	on_track: "On track",
	not_retained: "Not retained",
};

/** The pale-blue hatch that marks points a member can still unlock by answering a feedback form. */
export const PENDING_HATCH = { backgroundImage: "repeating-linear-gradient(135deg, var(--ring) 0 2px, transparent 2px 6px)" };

export function shortDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

function dateTime(date: Date): string {
	return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

function slotWords(part: RetentionPart, slot: RetentionSlot): string {
	const state = { met: "met", open: `${formatPoints(slot.counted)} of 1`, missed: "missed", upcoming: `opens ${shortDate(slot.startsAt)}` }[slot.state];
	return `${part.label}, ${slot.label.toLowerCase()}: ${state}`;
}

/** One cell per slot, in grid order: the whole year at a glance, readable without color. */
export function SlotStrip({ progress, className }: { progress: RetentionProgress; className?: string }) {
	const slots = progress.parts.flatMap((part) => part.slots.map((slot) => ({ part, slot })));
	return (
		<ol className={cn("grid min-w-0 gap-1", className)} style={{ gridTemplateColumns: `repeat(${Math.max(1, slots.length)}, minmax(0, 1fr))` }} aria-label={`${progress.met} of ${progress.required} requirements met`}>
			{slots.map(({ part, slot }) => (
				<li
					key={slot.key}
					title={slotWords(part, slot)}
					className={cn(
						"h-2.5 rounded-sm",
						slot.state === "met" && "bg-accent",
						slot.state === "open" && "bg-secondary",
						slot.state === "upcoming" && "border border-dashed border-border",
						slot.state === "missed" && "bg-foreground/20",
					)}
					style={slot.state === "open" && slot.pending > 0 ? PENDING_HATCH : undefined}
				>
					<span className="sr-only">{slotWords(part, slot)}</span>
				</li>
			))}
		</ol>
	);
}

/** "On track. 5 of 12 met." plus the strip and the next deadline. */
export function RetentionVerdict({ progress, compact = false }: { progress: RetentionProgress; compact?: boolean }) {
	const deadline = progress.nextDeadline;
	return (
		<div className="grid min-w-0 gap-3">
			<p className={cn("min-w-0 text-pretty", compact ? "text-base" : "text-lg sm:text-xl")}>
				<span className="font-semibold">{STATUS_LABEL[progress.status]}.</span>{" "}
				<span className="tabular-nums">
					{progress.met} of {progress.required} requirements met
				</span>
				{progress.missed > 0 ? <span className="text-muted-foreground"> ({progress.missed} missed)</span> : null}
			</p>
			<SlotStrip progress={progress} />
			{deadline && progress.status !== "not_retained" ? (
				<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
					<span className="font-medium text-foreground">Next deadline {shortDate(deadline.at)}:</span> {deadline.parts.join(", ")}
				</p>
			) : null}
		</div>
	);
}

function SlotCell({ slot, spans }: { slot: RetentionSlot; spans: boolean }) {
	const open = Math.max(0, 1 - slot.counted);
	const pending = Math.min(slot.pending, open);
	return (
		<div
			className={cn(
				"grid min-w-0 content-start gap-2 rounded-md border bg-card p-3",
				spans ? "col-span-2" : "col-span-1",
				slot.state === "met" && "border-accent/50",
				slot.state === "upcoming" && "border-dashed bg-transparent",
				slot.state === "missed" && "bg-secondary/40",
			)}
		>
			<div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
				<span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
					{slot.state === "met" ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
					{slot.state === "missed" ? <X className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
					{slot.state === "met" ? "Met" : slot.state === "missed" ? "Missed" : slot.state === "upcoming" ? `Opens ${shortDate(slot.startsAt)}` : `${formatPoints(slot.counted)} of 1`}
				</span>
				<span className="text-xs text-muted-foreground">{slot.state === "upcoming" ? `until ${shortDate(slot.countsUntil)}` : `Counts until ${shortDate(slot.countsUntil)}`}</span>
			</div>
			<div
				className="flex h-2 overflow-hidden rounded-full bg-secondary"
				role="meter"
				aria-label={`${slot.label} progress`}
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={slot.counted}
				aria-valuetext={`${formatPoints(slot.counted)} of 1 point`}
			>
				<div className={cn("h-full", slot.state === "missed" ? "bg-foreground/30" : "bg-accent")} style={{ width: `${slot.counted * 100}%` }} />
				{pending > 0 ? <div className="h-full" style={{ ...PENDING_HATCH, width: `${pending * 100}%` }} /> : null}
			</div>
			{slot.overflow > 0 || pending > 0 || slot.state === "missed" ? (
				<div className="flex min-w-0 flex-wrap gap-1.5 text-xs">
					{pending > 0 ? <span className="rounded-sm px-1.5 py-0.5 font-medium text-foreground" style={PENDING_HATCH}><span className="rounded-sm bg-card px-1">+{formatPoints(pending)} when you answer</span></span> : null}
					{slot.overflow > 0 ? (
						<span className="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-muted-foreground">+{formatPoints(slot.overflow)} extra, not counted</span>
					) : null}
					{slot.state === "missed" ? <span className="text-muted-foreground">This slot closed with {formatPoints(Math.max(0, slot.earned))} of 1.</span> : null}
				</div>
			) : null}
		</div>
	);
}

export type NextEvent = { eventId: string; title: string; startsAt: Date };

/**
 * The report card: two semester columns, a row per part. A yearly part's cell spans both columns. Below md the part
 * name moves above its cells and the two columns stay.
 */
export function RetentionGrid({ progress, nextEvents }: { progress: RetentionProgress; nextEvents?: Map<string, NextEvent> }) {
	const yearly = progress.parts.filter((part) => part.period === "year");
	const semestral = progress.parts.filter((part) => part.period === "semester");
	const [firstSemester, secondSemester] = semestral[0]?.slots ?? [];
	const row = (part: RetentionPart) => {
		const due = part.slots.some((slot) => slot.state === "open");
		const next = due ? nextEvents?.get(part.pointTypeId) : undefined;
		return (
			<div key={part.pointTypeId} className="col-span-2 grid min-w-0 grid-cols-2 gap-2 md:col-span-3 md:grid-cols-subgrid">
				<div className="col-span-2 min-w-0 md:col-span-1 md:pt-2">
					<p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{part.label}</p>
					{next ? (
						<Link
							href={`/portal/calendar/${next.eventId}`}
							className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs font-medium text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span className="min-w-0 truncate">
								Next: {next.title}, {shortDate(next.startsAt)}
							</span>
							<ArrowRight className="size-3 shrink-0" aria-hidden />
						</Link>
					) : null}
				</div>
				{part.slots.map((slot) => (
					<SlotCell key={slot.key} slot={slot} spans={part.period === "year"} />
				))}
			</div>
		);
	};
	const groupHeading = (title: string, note: string) => (
		<div className="col-span-2 mt-4 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1.5 first:mt-0 md:col-span-3">
			<h3 className="font-heading text-lg">{title}</h3>
			<p className="text-xs text-muted-foreground">{note}</p>
		</div>
	);
	return (
		<div className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-3">
			{firstSemester && secondSemester ? (
				<div className="col-span-2 grid min-w-0 grid-cols-2 gap-2 text-xs text-muted-foreground md:col-span-3 md:grid-cols-subgrid">
					<span className="hidden md:block" />
					<p className="min-w-0">
						<span className="block text-sm font-semibold text-foreground">1st semester</span>
						{shortDate(firstSemester.startsAt)} to {shortDate(firstSemester.countsUntil)}
					</p>
					<p className="min-w-0">
						<span className="block text-sm font-semibold text-foreground">2nd semester</span>
						{shortDate(secondSemester.startsAt)} to {shortDate(secondSemester.countsUntil)}
					</p>
				</div>
			) : null}
			{yearly.length > 0 ? groupHeading("Once this school year", "1 point each, any time in the year") : null}
			{yearly.map(row)}
			{semestral.length > 0 ? groupHeading("Once each semester", "1 point each semester; extra points do not carry over") : null}
			{semestral.map(row)}
		</div>
	);
}

/** Forms whose answer still owes the member the rest of an event's points, one row per event. */
export function PendingFeedback({ shares }: { shares: PendingShare[] }) {
	const events = Array.from(
		shares.reduce((map, share) => map.set(share.eventId, [...(map.get(share.eventId) ?? []), share]), new Map<string, PendingShare[]>()).values(),
	);
	if (events.length === 0) return null;
	const total = shares.reduce((sum, share) => sum + share.points, 0);
	return (
		<section aria-labelledby="pending-feedback" className="grid min-w-0 gap-3 rounded-lg border border-ring/60 bg-secondary/50 p-4">
			<div className="min-w-0">
				<h2 id="pending-feedback" className="font-heading text-xl">
					{formatPoints(total)} {total === 1 ? "point is" : "points are"} waiting on feedback forms
				</h2>
				<p className="mt-1 max-w-prose text-sm text-muted-foreground">
					An event with a feedback form gives 75% of its points when you check in. Answer its form to get the other 25%. If the form closes first, that 25% is gone.
				</p>
			</div>
			<ul className="grid min-w-0 divide-y divide-border/60 rounded-md border border-border/60 bg-card">
				{events.map((rows) => {
					const [first] = rows;
					return (
						<li key={first.eventId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
							<div className="min-w-0">
								<p className="min-w-0 font-medium [overflow-wrap:anywhere]">{first.eventTitle}</p>
								<p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
									{rows.map((row) => `+${formatPoints(row.points)} ${row.pointTypeLabel}`).join(", ")}
									{" · "}
									{first.surveyStatus === "draft" ? "The form opens after the event" : first.closesAt ? `Closes ${dateTime(first.closesAt)}` : "Open now"}
								</p>
							</div>
							{first.surveyStatus === "running" ? (
								<Link
									href={`/portal/surveys/${first.surveyId}`}
									className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								>
									Answer
									<ArrowRight className="size-4" aria-hidden />
								</Link>
							) : null}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
