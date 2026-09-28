import Link from "next/link";
import { Filter } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AttendanceStatusCell } from "@/components/portal/attendance-status-cell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getDb } from "@/db/client";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { loadRetentionPickers } from "../retention/data";
import { firstParams, formatDateTime, PAGE_SIZE, Pager, sectionTitle, TermSelector, type SearchParams } from "../shared";

export const dynamic = "force-dynamic";

const optionalDate = z.preprocess((value) => (value === "" ? undefined : value), z.coerce.date().optional()).catch(undefined);
const scansQuerySchema = z
	.object({
		termId: z.string().max(60).optional(),
		page: z.coerce.number().int().min(1).max(10_000).catch(1),
		eventId: z.string().max(60).optional(),
		scannerId: z.string().max(60).optional(),
		memberId: z.string().max(60).optional(),
		from: optionalDate,
		to: optionalDate,
	})
	.refine((v) => !v.from || !v.to || v.from <= v.to, { path: ["to"], message: "End date must not precede the start." });

function dateValue(value: Date | undefined) {
	return value ? value.toISOString().slice(0, 10) : undefined;
}

export default async function ScansAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const params = scansQuerySchema.parse(firstParams(await searchParams));
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === params.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const toExclusive = params.to ? new Date(params.to.getTime() + 24 * 60 * 60_000) : undefined;
	const rows = selectedTerm
		? await createAttendanceReports(getDb()).scanLog(actor, selectedTerm.id, {
				limit: PAGE_SIZE,
				offset: (params.page - 1) * PAGE_SIZE,
				eventId: params.eventId,
				scannerId: params.scannerId,
				memberId: params.memberId,
				from: params.from,
				to: toExclusive,
			})
		: [];
	const urlParams = new URLSearchParams();
	for (const [key, value] of Object.entries({
		termId: selectedTerm?.id,
		eventId: params.eventId,
		scannerId: params.scannerId,
		memberId: params.memberId,
		from: dateValue(params.from),
		to: dateValue(params.to),
	})) if (value) urlParams.set(key, value);
	urlParams.set("page", String(params.page));
	const hasFilters = Boolean(params.eventId || params.scannerId || params.memberId || params.from || params.to);

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="font-heading text-3xl tracking-tight text-primary sm:text-4xl">Scan log</h1>
				<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">What happened at the door, and who did it.</p>
			</header>

			{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} hidden={{ eventId: params.eventId, scannerId: params.scannerId, memberId: params.memberId, from: dateValue(params.from), to: dateValue(params.to) }} /> : null}

			<form className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
				<input type="hidden" name="termId" value={selectedTerm?.id ?? ""} />
				<label className="grid gap-1 text-sm font-medium">
					Event
					<Select name="eventId" defaultValue={params.eventId ?? ""}>
						<option value="">All events</option>
						{pickers.events.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
					</Select>
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Scanner
					<Select name="scannerId" defaultValue={params.scannerId ?? ""}>
						<option value="">All scanners</option>
						{pickers.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
					</Select>
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Member
					<Select name="memberId" defaultValue={params.memberId ?? ""}>
						<option value="">All members</option>
						{pickers.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
					</Select>
				</label>
				<label className="grid gap-1 text-sm font-medium">
					From
					<Input type="date" name="from" defaultValue={dateValue(params.from)} />
				</label>
				<label className="grid gap-1 text-sm font-medium">
					To
					<Input type="date" name="to" defaultValue={dateValue(params.to)} />
				</label>
				<div className="flex items-end gap-2">
					<Button type="submit" variant="secondary"><Filter className="size-4" />Filter</Button>
					{hasFilters ? <Button asChild variant="ghost"><Link href={`/portal/admin/data/scans?termId=${selectedTerm?.id ?? ""}`}>Clear</Link></Button> : null}
				</div>
			</form>

			<section className="grid gap-3">
				{sectionTitle("Door activity")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[860px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Time</th>
									<th className="px-4 py-2.5 font-semibold">Member</th>
									<th className="px-4 py-2.5 font-semibold">Event</th>
									<th className="px-4 py-2.5 font-semibold">Action</th>
									<th className="px-4 py-2.5 font-semibold">Status</th>
									<th className="px-4 py-2.5 font-semibold">Actor</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{rows.length === 0 ? (
									<tr><td className="px-4 py-2.5 text-muted-foreground" colSpan={6}>{hasFilters ? "No scans match those filters. Clear filters to return to the scan log." : "No door activity yet. Run check-in from an event to populate this log."}</td></tr>
								) : rows.map((row) => {
									const undone = row.action === "event:undo_scan";
									return (
										<tr key={row.id} className={undone ? "text-muted-foreground line-through decoration-muted-foreground" : undefined}>
											<td className="px-4 py-2.5 tabular-nums">{formatDateTime(row.createdAt)}</td>
											<td className="min-w-0 break-all px-4 py-2.5">{row.memberName ?? row.memberId ?? "Unknown member"}</td>
											<td className="min-w-0 px-4 py-2.5"><Link href={`/portal/admin/data/events/${row.eventId}`} className="break-all text-primary underline-offset-4 hover:underline">{row.eventTitle}</Link></td>
											<td className="px-4 py-2.5">{undone ? "Reversed scan" : "Scanned in"}</td>
											<td className="px-4 py-2.5"><AttendanceStatusCell scannedAt={row.createdAt} startsAt={row.eventStartsAt} graceMinutes={row.graceMinutes} /></td>
											<td className="min-w-0 break-all px-4 py-2.5">{undone ? `Reversed by ${row.scannerName ?? row.scannerId ?? "Unknown actor"}` : row.scannerName ?? row.scannerId ?? "Unknown actor"}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</CardContent>
				</Card>
				<Pager basePath="/portal/admin/data/scans" params={urlParams} page={params.page} hasNext={rows.length === PAGE_SIZE} />
			</section>
		</div>
	);
}
