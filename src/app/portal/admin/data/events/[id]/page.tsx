import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AttendanceStatusCell } from "@/components/portal/attendance-status-cell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import { crsEvents, eventStaff, retentionRecords } from "@/db/schema";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { displayName, formatDateTime, formatTime, sectionTitle } from "../../shared";
import { formatPoints, quantizePoints } from "@/lib/points";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().max(60) });

export default async function EventRosterPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const { id } = paramsSchema.parse(await params);
	const db = getDb() as unknown as DrizzleD1Database<typeof schema>;
	const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, id)).limit(1);
	if (!event) notFound();
	const [roster, scannerRows, pointRows] = await Promise.all([
		createAttendanceReports(db).eventRoster(actor, id),
		db.select({ count: sql<number>`count(*)` }).from(eventStaff).where(eq(eventStaff.eventId, id)),
		db
			.select({ memberId: retentionRecords.memberId, points: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)` })
			.from(retentionRecords)
			.where(eq(retentionRecords.eventId, id))
			.groupBy(retentionRecords.memberId),
	]);
	const pointsByMember = new Map(pointRows.map((row) => [row.memberId, quantizePoints(Number(row.points))]));
	const attendees = roster.filter((row) => row.scannedAt);
	const absents = roster.filter((row) => !row.scannedAt);
	const scannerCount = Number(scannerRows[0]?.count ?? 0);
	const checkinOpens = new Date(event.startsAt.getTime() - 30 * 60_000);

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="min-w-0 break-all font-heading text-3xl tracking-tight text-primary sm:text-4xl">{event.title}</h1>
				<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Who attended, and who was late.</p>
				<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
					<span className="tabular-nums">{formatDateTime(event.startsAt)}</span>
					<span className="min-w-0 break-all">{event.place}</span>
					<span className="capitalize">{event.type}</span>
					<span className="tabular-nums">Grace {event.graceMinutes ?? 15} min</span>
					<span className="tabular-nums">{attendees.length} attended</span>
					<span className="tabular-nums">{absents.length} absent</span>
				</div>
			</header>

			{attendees.length === 0 ? (
				<Card>
					<CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
						<div className="flex min-w-0 items-center gap-3">
							<CalendarClock className="size-4 shrink-0" />
							<p>
								{scannerCount === 0
									? "No one has checked in, and no scanner is assigned. Assign a scanner from the event staff panel."
									: `No one has checked in. Check-in opens 30 minutes before start, at ${formatTime(checkinOpens)}.`}
							</p>
						</div>
						{scannerCount === 0 ? (
							<Button asChild variant="outline" size="sm">
								<Link href={`/portal/calendar/${id}`}>Open event</Link>
							</Button>
						) : null}
					</CardContent>
				</Card>
			) : null}

			<section className="grid gap-3">
				{sectionTitle("Attendees")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Member</th>
									<th className="px-4 py-2.5 font-semibold">Scanned at</th>
									<th className="px-4 py-2.5 font-semibold">Status</th>
									<th className="px-4 py-2.5 font-semibold">Scanned by</th>
									<th className="px-4 py-2.5 text-right font-semibold">Points</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{attendees.length === 0 ? (
									<tr>
										<td className="px-4 py-2.5 text-muted-foreground" colSpan={5}>Scans will appear here when check-in starts.</td>
									</tr>
								) : (
									attendees.map((row) => (
										<tr key={row.memberId}>
											<td className="min-w-0 px-4 py-2.5">
												<Link href={`/portal/admin/members/${row.memberId}`} className="break-all font-medium text-primary underline-offset-4 hover:underline">
													{displayName(row)}
												</Link>
											</td>
											<td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.scannedAt ? formatTime(row.scannedAt) : ""}</td>
											<td className="px-4 py-2.5"><AttendanceStatusCell scannedAt={row.scannedAt} startsAt={row.startsAt} graceMinutes={row.graceMinutes} /></td>
											<td className="min-w-0 break-all px-4 py-2.5">{row.scannedByName ?? row.scannedById ?? "Unknown"}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(pointsByMember.get(row.memberId) ?? 0)}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</CardContent>
				</Card>
			</section>

			{absents.length > 0 ? (
				<details className="rounded-lg border border-border bg-card p-4">
					<summary className="cursor-pointer text-sm font-semibold text-foreground">Show {absents.length} absent</summary>
					<div className="mt-3 divide-y divide-border">
						{absents.map((row) => (
							<div key={row.memberId} className="grid gap-1 py-2.5 text-sm text-muted-foreground sm:grid-cols-[1fr_auto]">
								<Link href={`/portal/admin/members/${row.memberId}`} className="min-w-0 break-all font-medium text-foreground underline-offset-4 hover:underline">
									{displayName(row)}
								</Link>
								<span className="text-xs">Absent</span>
							</div>
						))}
					</div>
				</details>
			) : null}
		</div>
	);
}



