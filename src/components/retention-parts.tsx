import Link from "next/link";
import { ArrowRight, Check, CircleCheck, X } from "lucide-react";
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

/** A slot as a mini bar: earned in navy, a pending feedback share hatched, an unopened semester dashed. */
function StripCell({ part, slot }: { part: RetentionPart; slot: RetentionSlot }) {
	const pending = Math.min(slot.pending, Math.max(0, 1 - slot.counted));
	return (
		<li
			title={slotWords(part, slot)}
			className={cn(
				"flex h-2.5 overflow-hidden rounded-sm",
				slot.state === "upcoming" ? "border border-dashed border-border" : "bg-secondary",
				slot.state === "missed" && "bg-foreground/20",
			)}
		>
			{slot.state === "open" || slot.state === "met" ? <span className="h-full bg-accent" style={{ width: `${slot.counted * 100}%` }} /> : null}
			{slot.state === "open" && pending > 0 ? <span className="h-full" style={{ ...PENDING_HATCH, width: `${pending * 100}%` }} /> : null}
			<span className="sr-only">{slotWords(part, slot)}</span>
		</li>
	);
}

/** The whole year at a glance: the yearly slots, a gap, then the semester slots, with a key. Readable without color. */
export function SlotStrip({ progress, showKey = true, className }: { progress: RetentionProgress; showKey?: boolean; className?: string }) {
	const group = (period: RetentionPart["period"]) => progress.parts.filter((part) => part.period === period).flatMap((part) => part.slots.map((slot) => ({ part, slot })));
	const groups = [group("year"), group("semester")].filter((cells) => cells.length > 0);
	return (
		<div className={cn("grid min-w-0 gap-2", className)}>
			<div className="flex min-w-0 gap-3" role="list" aria-label={`${progress.met} of ${progress.required} requirements met`}>
				{groups.map((cells, index) => (
					<ol key={index} className="grid min-w-0 gap-1" style={{ flex: cells.length, gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
						{cells.map(({ part, slot }) => (
							<StripCell key={slot.key} part={part} slot={slot} />
						))}
					</ol>
				))}
			</div>
			{showKey ? <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
				<li className="flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm bg-accent" />Met</li>
				<li className="flex items-center gap-1.5"><span className="flex h-2 w-3.5 overflow-hidden rounded-sm bg-secondary"><span className="w-1/2 bg-accent" /></span>Part done</li>
				<li className="flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm" style={PENDING_HATCH} />Waiting on a form</li>
				<li className="flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm border border-dashed border-border" />Not open yet</li>
			</ul> : null}
		</div>
	);
}

const pendingTotal = (progress: RetentionProgress) =>
	progress.parts.reduce((sum, part) => sum + part.slots.reduce((inner, slot) => inner + (slot.state === "open" ? slot.pending : 0), 0), 0);

/** "On track. 5 of 12 requirements met in SY 2026-2027." plus the strip and one line on what to do next. */
/** plain drops the lines spoken to the member ("Nice work"), for officers reading someone else's progress. */
export function RetentionVerdict({ progress, termName, compact = false, plain = false }: { progress: RetentionProgress; termName?: string; compact?: boolean; plain?: boolean }) {
	const deadline = progress.nextDeadline;
	const waiting = pendingTotal(progress);
	return (
		<div className="grid min-w-0 gap-3">
			<p className={cn("flex min-w-0 items-start gap-2 text-pretty", compact ? "text-base" : "text-lg sm:text-xl")}>
				{progress.status === "retained" ? <CircleCheck className={cn("shrink-0 text-accent", compact ? "mt-0.5 size-5" : "mt-1 size-6")} aria-hidden /> : null}
				<span className="min-w-0">
					<span className="font-semibold">{STATUS_LABEL[progress.status]}.</span>{" "}
					<span className="tabular-nums">
						{progress.met} of {progress.required} requirements met
						{termName ? (
							<>
								{" in "}
								<span className="whitespace-nowrap">{termName}</span>
							</>
						) : null}
					</span>
					{progress.missed > 0 ? <span className="text-muted-foreground"> ({progress.missed} missed)</span> : null}
				</span>
			</p>
			{/* Once every box is full there is nothing left to decode, so the key goes. */}
			<SlotStrip progress={progress} showKey={!compact && progress.status !== "retained"} />
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
			<div className={cn("min-w-0 self-start rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground", spans ? "col-span-2" : "col-span-1")}>
				Opens {shortDate(slot.startsAt)}
			</div>
		);
	}
	return (
		<div
			className={cn(
				"grid min-w-0 content-start gap-2 rounded-md border p-3",
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
