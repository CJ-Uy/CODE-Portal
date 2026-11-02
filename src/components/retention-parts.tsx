import Link from "next/link";
import { ArrowRight, Check, CircleCheck, X } from "lucide-react";
import type { PendingShare } from "@/db/repositories/retention";
import { formatPoints, quantizePoints } from "@/lib/points";
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

const pendingTotal = (progress: RetentionProgress) =>
	progress.parts.reduce((sum, part) => sum + part.slots.reduce((inner, slot) => inner + (slot.state === "open" ? slot.pending : 0), 0), 0);

function RequirementRing({ label, slots, compact, overall }: { label: string; slots: RetentionSlot[]; compact: boolean; overall: boolean }) {
	const points = quantizePoints(slots.reduce((sum, slot) => sum + slot.counted, 0));
	const upcoming = slots.every((slot) => slot.state === "upcoming");
	return (
		<div className="grid min-w-0 content-start justify-items-center gap-2 text-center">
			<div
				className={cn("relative aspect-square w-full", overall ? compact ? "max-w-20" : "max-w-28 sm:max-w-32" : compact ? "max-w-14" : "max-w-18 sm:max-w-20")}
				role="progressbar"
				aria-label={`${label} retention points`}
				aria-valuemin={0}
				aria-valuemax={slots.length}
				aria-valuenow={points}
				aria-valuetext={`${formatPoints(points)} of ${slots.length} retention points`}
			>
				<svg viewBox="0 0 100 100" className="size-full -rotate-90" fill="none" strokeWidth="8" aria-hidden focusable="false">
					<circle cx="50" cy="50" r="43" className="stroke-secondary" />
					{points > 0 ? <circle cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${(points / slots.length) * 100} 100`} strokeLinecap="round" className="stroke-accent" /> : null}
				</svg>
				<span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
					<span className={cn("font-semibold tabular-nums", overall ? compact ? "text-lg" : "text-2xl sm:text-3xl" : compact ? "text-xs" : "text-base sm:text-lg")}>{formatPoints(points)}<span className="text-xs font-normal text-muted-foreground">/{slots.length}</span></span>
					<span className={cn("text-xs text-muted-foreground", compact && !overall && "sr-only")}>points</span>
				</span>
			</div>
			<div className="min-w-0">
				<p className="text-sm font-semibold">{label}</p>
				{upcoming ? <p className="mt-0.5 text-xs text-muted-foreground">Opens {shortDate(slots[0].startsAt)}</p> : null}
			</div>
		</div>
	);
}

/** Completed requirements first, then the retention status and next deadline. */
/** plain drops the lines spoken to the member ("Nice work"), for officers reading someone else's progress. */
export function RetentionVerdict({ progress, termName, compact = false, plain = false }: { progress: RetentionProgress; termName?: string; compact?: boolean; plain?: boolean }) {
	const deadline = progress.nextDeadline;
	const waiting = pendingTotal(progress);
	const semestral = progress.parts.filter((part) => part.period === "semester");
	const groups = [
		{ label: "Overall", slots: progress.parts.flatMap((part) => part.slots) },
		...["1st semester", "2nd semester"].map((label, index) => ({ label, slots: semestral.flatMap((part) => part.slots.slice(index, index + 1)) })),
	].filter((group) => group.slots.length > 0);
	return (
		<div className="grid min-w-0 gap-3">
			<div className="grid min-w-0 gap-1">
				<p className={cn("font-semibold tabular-nums text-pretty", compact ? "text-lg" : "text-xl sm:text-2xl")}>
					{progress.met} of {progress.required} requirements met
				</p>
				{termName ? <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{termName}</p> : null}
			</div>
			{groups.length > 0 ? (
				<div className="grid min-w-0 max-w-md grid-cols-[minmax(0,1.25fr)_repeat(2,minmax(0,1fr))] items-center gap-3 py-1">
					{groups.map((group, index) => <RequirementRing key={group.label} {...group} compact={compact} overall={index === 0} />)}
				</div>
			) : null}
			<p className="flex min-w-0 items-start gap-2 text-sm">
				{progress.status === "retained" ? <CircleCheck className="size-4 shrink-0 text-accent" aria-hidden /> : null}
				<span>
					<span className="font-semibold">{STATUS_LABEL[progress.status]}.</span>
					{progress.status === "on_track" ? <span className="text-muted-foreground"> No requirements missed.</span> : null}
					{progress.missed > 0 ? <span className="text-muted-foreground"> {progress.missed} missed.</span> : null}
				</span>
			</p>
			{progress.status === "on_track" ? (
				deadline ? (
					<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
						<span className="font-medium text-foreground">Next deadline {shortDate(deadline.at)}:</span>{" "}
						{compact ? `${deadline.parts.length} ${deadline.parts.length === 1 ? "part" : "parts"} still open` : deadline.parts.join(", ")}
					</p>
				) : null
			) : plain ? null : (
				<p className="text-sm text-muted-foreground">
					{progress.status === "retained"
						? "Every requirement is met for this school year. Nice work."
						: "A requirement closed before it was met. If a record is missing, an officer can add it."}
				</p>
			)}
			{compact && waiting > 0 ? (
				<p className="flex min-w-0 items-center gap-2 text-sm">
					<span className="size-3 shrink-0 rounded-sm border border-ring/60" style={PENDING_HATCH} aria-hidden />
					<span>
						<span className="font-medium tabular-nums">+{formatPoints(waiting)}</span> waiting on your feedback forms
					</span>
				</p>
			) : null}
		</div>
	);
}

function SlotCell({ slot, spans, pendingHref }: { slot: RetentionSlot; spans: boolean; pendingHref?: string }) {
	const open = Math.max(0, 1 - slot.counted);
	const pending = Math.min(slot.pending, open);
	const met = slot.state === "met";
	if (slot.state === "upcoming") {
		return (
			<div className={cn("min-h-32 min-w-0 rounded-md border border-dashed p-3 text-sm text-muted-foreground md:min-h-24", spans ? "col-span-2" : "col-span-1")}>
				Opens {shortDate(slot.startsAt)}
			</div>
		);
	}
	return (
		<div
			className={cn(
				"grid min-h-32 min-w-0 content-start gap-2 rounded-md border p-3 md:min-h-24",
				spans ? "col-span-2" : "col-span-1",
				met ? "border-accent bg-accent text-accent-foreground" : slot.state === "missed" ? "bg-secondary/40" : "bg-card",
			)}
		>
			<div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
				<span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
					{met ? <Check className="size-4 shrink-0" aria-hidden /> : null}
					{slot.state === "missed" ? <X className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
					{met ? "Met" : slot.state === "missed" ? "Missed" : `${formatPoints(slot.counted)} of 1`}
				</span>
				{met ? null : <span className="text-xs text-muted-foreground">Counts until {shortDate(slot.countsUntil)}</span>}
			</div>
			{/* A met cell is its own full bar. */}
			{met ? null : (
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
			)}
			{slot.overflow > 0 || pending > 0 || slot.state === "missed" ? (
				<div className="flex min-w-0 flex-wrap gap-1.5 text-xs">
					{pending > 0 ? (
						pendingHref ? (
							<a
								href={pendingHref}
								className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="size-3 shrink-0 rounded-sm border border-ring/60" style={PENDING_HATCH} aria-hidden />+{formatPoints(pending)} after the form
							</a>
						) : (
							<span className="inline-flex items-center gap-1.5 font-medium">
								<span className="size-3 shrink-0 rounded-sm border border-ring/60" style={PENDING_HATCH} aria-hidden />+{formatPoints(pending)} after the form
							</span>
						)
					) : null}
					{slot.overflow > 0 ? (
						<span className={cn("rounded-sm border border-dashed px-1.5 py-0.5", met ? "border-accent-foreground/50 text-accent-foreground/85" : "border-border text-muted-foreground")}>
							+{formatPoints(slot.overflow)} extra, not counted
						</span>
					) : null}
					{slot.state === "missed" ? <span className="text-muted-foreground">Closed at {formatPoints(Math.max(0, slot.earned))} of 1</span> : null}
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
export function RetentionGrid({ progress, nextEvents, pendingHref }: { progress: RetentionProgress; nextEvents?: Map<string, NextEvent>; pendingHref?: string }) {
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
					<SlotCell key={slot.key} slot={slot} spans={part.period === "year"} pendingHref={pendingHref} />
				))}
			</div>
		);
	};
	const groupHeading = (title: string, note: string) => (
		<div className="col-span-2 mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1.5 md:col-span-3">
			<h3 className="font-heading text-lg">{title}</h3>
			<p className="text-xs text-muted-foreground">{note}</p>
		</div>
	);
	return (
		<div className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-3">
			{firstSemester && secondSemester ? (
				<div className="col-span-2 grid min-w-0 grid-cols-2 gap-2 pb-1 text-xs text-muted-foreground md:col-span-3 md:grid-cols-subgrid">
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
			{yearly.length > 0 ? groupHeading("Once this school year", "1 point, any time") : null}
			{yearly.map(row)}
			{semestral.length > 0 ? groupHeading("Once each semester", "1 point in each") : null}
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
		<section id="pending-feedback" aria-labelledby="pending-feedback-heading" className="grid min-w-0 scroll-mt-24 gap-3 rounded-lg border border-ring/60 bg-secondary/50 p-4">
			<div className="min-w-0">
				<div className="flex min-w-0 items-baseline justify-between gap-3">
					<h2 id="pending-feedback-heading" className="font-heading text-xl">
						Feedback forms waiting on you
					</h2>
					<span className="shrink-0 font-semibold tabular-nums">+{formatPoints(total)}</span>
				</div>
				<p className="mt-1 text-sm text-muted-foreground">Check-in gave you 75%. Answer before the form closes to get the rest.</p>
			</div>
			<ul className="grid min-w-0 divide-y divide-border/60 border-t border-border/60">
				{events.map((rows) => {
					const [first] = rows;
					return (
						<li key={first.eventId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
							<div className="min-w-0">
								<p className="min-w-0 font-medium [overflow-wrap:anywhere]">{first.eventTitle}</p>
								<p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
									{rows.map((row) => `+${formatPoints(row.points)} ${row.pointTypeLabel}`).join(", ")}
									{" · "}
									{first.surveyStatus === "draft" ? "Opens after the event" : first.closesAt ? `Closes ${dateTime(first.closesAt)}` : "Open now"}
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
