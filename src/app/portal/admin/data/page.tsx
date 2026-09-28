import Link from "next/link";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { Download, Settings2 } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { crsEvents, eventPointAwards } from "@/db/schema";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { ManualRecordSheet } from "./manual-record-sheet";
import { loadRetentionPickers } from "./retention/data";
import { firstParams, formatDateTime, sectionTitle, TermSelector, type SearchParams } from "./shared";

export const dynamic = "force-dynamic";

const querySchema = z.object({ termId: z.string().max(60).optional() });

export default async function DataGroupPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const params = querySchema.parse(firstParams(await searchParams));
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === params.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const db = getDb() as unknown as DrizzleD1Database<typeof schema>;
	const reports = createAttendanceReports(db);
	const [summaries, scanRows, memberRows, awardRows] = selectedTerm
		? await Promise.all([
				reports.termEventSummaries(actor, selectedTerm.id),
				reports.scanLog(actor, selectedTerm.id, { limit: 5 }),
				reports.termMemberSummaries(actor, selectedTerm.id, { limit: 200 }),
				db
					.select({ eventId: eventPointAwards.eventId })
					.from(eventPointAwards)
					.innerJoin(crsEvents, eq(crsEvents.id, eventPointAwards.eventId))
					.where(and(gte(crsEvents.startsAt, selectedTerm.startsAt), lte(crsEvents.startsAt, selectedTerm.endsAt), isNull(crsEvents.deletedAt)))
					.groupBy(eventPointAwards.eventId),
			])
		: [[], [], [], []];
	const awardEventIds = new Set(awardRows.map((row) => row.eventId));
	const endedNoAttendance = summaries
		.filter((event) => event.status === "approved" && (event.endsAt ?? event.startsAt) < now && event.attendedCount === 0)
		.slice(0, 5);
	const awardsNoScans = summaries.filter((event) => awardEventIds.has(event.eventId) && event.attendedCount === 0).slice(0, 5);
	const belowProbation = memberRows
		.map((member) => ({ ...member, total: member.pointsByType[RETENTION_POINT_TYPE_ID] ?? 0 }))
		.filter((member) => selectedTerm && member.total < selectedTerm.probationBelow)
		.sort((a, b) => a.total - b.total)
		.slice(0, 5);
	const totalAttended = summaries.reduce((sum, event) => sum + event.attendedCount, 0);
	const totalLate = summaries.reduce((sum, event) => sum + event.lateCount, 0);
	const totalPoints = summaries.reduce((sum, event) => sum + event.pointsIssued, 0);

	return (
		<div className="grid gap-5">
			<header className="grid gap-4 border-b border-border pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
				<div>
					<h1 className="font-heading text-3xl tracking-tight text-primary sm:text-4xl">Events & points</h1>
					<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
						What needs your attention this term.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild variant="outline">
						<Link href="/portal/admin/system/point-types">
							<Settings2 className="size-4" />
							Point types
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link href="/portal/admin/data/exports">
							<Download className="size-4" />
							Export
						</Link>
					</Button>
					<ManualRecordSheet members={pickers.members} terms={pickers.terms} events={pickers.events} pointTypes={pickers.pointTypes} />
				</div>
			</header>

			{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} /> : null}

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Metric label="Events" value={String(summaries.length)} detail="In this school year." />
				<Metric label="Scans" value={String(totalAttended)} detail="Current attended records." />
				<Metric label="Late" value={String(totalLate)} detail="Past the grace window." />
				<Metric label="Points" value={String(totalPoints)} detail="Issued from events." />
			</div>

			<section className="grid gap-3">
				<div className="flex items-center justify-between gap-3">
					{sectionTitle("Needs attention")}
					<Link href="/portal/admin/data/events" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
						See all
					</Link>
				</div>
				<div className="grid gap-3 lg:grid-cols-3">
					<AttentionList title="Approved ended with no scans" rows={endedNoAttendance.map((event) => ({ href: `/portal/admin/data/events/${event.eventId}`, label: event.title, meta: formatDateTime(event.startsAt) }))} />
					<AttentionList title="Awarded events with no scans" rows={awardsNoScans.map((event) => ({ href: `/portal/admin/data/events/${event.eventId}`, label: event.title, meta: formatDateTime(event.startsAt) }))} />
					<AttentionList title="Below probation" rows={belowProbation.map((member) => ({ href: `/portal/admin/members/${member.memberId}?termId=${selectedTerm?.id ?? ""}`, label: member.memberName ?? member.memberEmail, meta: `${member.total} points` }))} />
				</div>
			</section>

			<section className="grid gap-3">
				{sectionTitle("Recent scans")}
				<Card>
					<CardContent className="divide-y divide-border p-0">
						{scanRows.length === 0 ? (
							<p className="px-4 py-2.5 text-sm text-muted-foreground">No scans recorded yet. Use event check-in to populate this log.</p>
						) : (
							scanRows.map((row) => (
								<div key={row.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[1fr_auto]">
									<p className="min-w-0 break-all font-medium">{row.memberName ?? row.memberId ?? "Unknown member"}</p>
									<p className="tabular-nums text-muted-foreground">{formatDateTime(row.createdAt)}</p>
									<p className="min-w-0 break-all text-muted-foreground sm:col-span-2">
										{row.action === "event:undo_scan" ? "Undo" : "Scan"} for {row.eventTitle} by {row.scannerName ?? row.scannerId ?? "Unknown scanner"}
									</p>
								</div>
							))
						)}
					</CardContent>
				</Card>
			</section>
		</div>
	);
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
	return (
		<Card>
			<CardContent className="p-4">
				<p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
				<p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
				<p className="mt-1 text-xs text-muted-foreground">{detail}</p>
			</CardContent>
		</Card>
	);
}

function AttentionList({ title, rows }: { title: string; rows: { href: string; label: string; meta: string }[] }) {
	return (
		<Card>
			<CardContent className="p-0">
				<p className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">{title}</p>
				<div className="divide-y divide-border">
					{rows.length === 0 ? (
						<p className="px-4 py-2.5 text-sm text-muted-foreground">Nothing needs action here.</p>
					) : (
						rows.map((row) => (
							<Link key={row.href} href={row.href} className="grid gap-1 px-4 py-2.5 text-sm hover:bg-secondary/50">
								<span className="min-w-0 break-all font-medium">{row.label}</span>
								<span className="text-xs text-muted-foreground">{row.meta}</span>
							</Link>
						))
					)}
				</div>
			</CardContent>
		</Card>
	);
}





