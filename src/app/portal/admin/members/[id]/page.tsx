import { and, asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AttendanceStatusCell } from "@/components/portal/attendance-status-cell";
import { RetentionProgress } from "@/components/portal/overview-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { getRepositories } from "@/db";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import { members, memberRoles, pointTypes, retentionRecords, roles } from "@/db/schema";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { formatPoints, quantizePoints } from "@/lib/points";
import { loadRetentionPickers } from "../../data/retention/data";
import { firstParams, formatDate, formatDateTime, formatTime, PAGE_SIZE, Pager, sectionTitle, TermSelector, type SearchParams } from "../../data/shared";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().max(60) });
const querySchema = z.object({
	termId: z.string().max(60).optional(),
	page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function AdminMemberProfilePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<SearchParams>;
}) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const { id } = paramsSchema.parse(await params);
	const query = querySchema.parse(firstParams(await searchParams));
	const db = getDb() as unknown as DrizzleD1Database<typeof schema>;
	const [member] = await db.select().from(members).where(eq(members.id, id)).limit(1);
	if (!member) notFound();
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === query.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const repositories = await getRepositories();
	const reports = createAttendanceReports(db);
	const [roleRows, summary, pointRows, attendanceRows, ledgerRows] = selectedTerm
		? await Promise.all([
				db
					.select({ label: roles.label })
					.from(memberRoles)
					.innerJoin(roles, eq(roles.id, memberRoles.roleId))
					.where(eq(memberRoles.memberId, id))
					.orderBy(asc(roles.label)),
				repositories.retention.getMemberTermSummary(actor, { memberId: id, termId: selectedTerm.id }),
				db
					.select({ pointTypeId: retentionRecords.pointTypeId, label: pointTypes.label, total: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)` })
					.from(retentionRecords)
					.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
					.where(and(eq(retentionRecords.memberId, id), eq(retentionRecords.termId, selectedTerm.id)))
					.groupBy(retentionRecords.pointTypeId, pointTypes.label)
					.orderBy(asc(pointTypes.position), asc(pointTypes.label)),
				reports.memberAttendance(actor, id, selectedTerm.id),
				repositories.retention.listMemberTermHistory(actor, id, selectedTerm.id, { limit: PAGE_SIZE, offset: (query.page - 1) * PAGE_SIZE }),
			])
		: [[], null, [], [], []];
	const urlParams = new URLSearchParams();
	if (selectedTerm) urlParams.set("termId", selectedTerm.id);
	urlParams.set("page", String(query.page));
	const memberName = member.fullName ?? member.name ?? member.email;
	const pointTotals = pointRows.map((row) => ({ ...row, total: quantizePoints(Number(row.total)) }));

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="min-w-0 break-all font-heading text-3xl tracking-tight text-primary sm:text-4xl">{memberName}</h1>
				<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
					<span className="min-w-0 break-all">{member.email}</span>
					<span className="capitalize">{member.status}</span>
					<span className="min-w-0 break-all">{roleRows.length ? roleRows.map((role) => role.label).join(", ") : "No admin roles"}</span>
				</div>
			</header>

			{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} /> : null}

			{summary ? (
				<section className="grid gap-3">
					{sectionTitle("Retention progress")}
					<Card><CardContent className="p-4"><RetentionProgress points={summary.totalPoints} retainedAt={summary.retainedAt} /><p className="mt-2 text-sm text-muted-foreground tabular-nums">Probation below {summary.probationBelow} points. Current status: {summary.status.replaceAll("_", " ")}.</p></CardContent></Card>
				</section>
			) : null}

			<section className="grid gap-3">
				{sectionTitle("Points by type")}
				<Card>
					<CardContent className="divide-y divide-border p-0">
						{pointTotals.filter((row) => row.total !== 0).length === 0 ? <p className="px-4 py-2.5 text-sm text-muted-foreground">No points yet. Add a manual record or scan attendance to populate this section.</p> : pointTotals.filter((row) => row.total !== 0).map((row) => <div key={row.pointTypeId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 break-all font-medium">{row.label}</span><span className="tabular-nums">{formatPoints(row.total)}</span></div>)}
					</CardContent>
				</Card>
			</section>

			<section className="grid gap-3">
				{sectionTitle("Events attended")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="px-4 py-2.5 font-semibold">Event</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Scanned at</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 text-right font-semibold">Points</th></tr></thead>
							<tbody className="divide-y divide-border">
								{attendanceRows.length === 0 ? <tr><td className="px-4 py-2.5 text-muted-foreground" colSpan={5}>No event attendance yet. RSVP or scan attendance to populate this section.</td></tr> : attendanceRows.map((row) => <tr key={row.eventId} className={!row.scannedAt ? "text-muted-foreground" : undefined}><td className="min-w-0 px-4 py-2.5"><span className="break-all font-medium">{row.eventTitle}</span></td><td className="px-4 py-2.5 tabular-nums">{formatDate(row.startsAt)}</td><td className="px-4 py-2.5 tabular-nums">{row.scannedAt ? formatTime(row.scannedAt) : ""}</td><td className="px-4 py-2.5"><AttendanceStatusCell scannedAt={row.scannedAt} startsAt={row.startsAt} graceMinutes={row.graceMinutes} /></td><td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(row.pointsEarned)}</td></tr>)}
							</tbody>
						</table>
					</CardContent>
				</Card>
			</section>

			<section className="grid gap-3">
				{sectionTitle("Ledger")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="px-4 py-2.5 font-semibold">Recorded</th><th className="px-4 py-2.5 font-semibold">Point type</th><th className="px-4 py-2.5 font-semibold">Reason</th><th className="px-4 py-2.5 text-right font-semibold">Points</th></tr></thead>
							<tbody className="divide-y divide-border">
								{ledgerRows.length === 0 ? <tr><td className="px-4 py-2.5 text-muted-foreground" colSpan={4}>No point records yet. Add a manual record or scan attendance to populate the ledger.</td></tr> : ledgerRows.map((row) => <tr key={row.recordId}><td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatDateTime(row.recordedAt)}</td><td className="min-w-0 break-all px-4 py-2.5">{row.pointTypeLabel}</td><td className="min-w-0 break-all px-4 py-2.5">{row.eventTitle ?? row.reason}</td><td className="px-4 py-2.5 text-right tabular-nums">{row.points ?? 0}</td></tr>)}
							</tbody>
						</table>
					</CardContent>
				</Card>
				<Pager basePath={`/portal/admin/members/${id}`} params={urlParams} page={query.page} hasNext={ledgerRows.length === PAGE_SIZE} />
			</section>
		</div>
	);
}



