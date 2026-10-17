import Link from "next/link";
import { Check, Search } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getRepositories } from "@/db";
import { getDb } from "@/db/client";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import type { EventFeedbackRow } from "@/db/types";
import { archiveHref, archiveRows, archiveTypes, feedbackCells } from "@/lib/feedback/archive-view";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { loadRetentionPickers } from "../retention/data";
import { firstParams, formatDate, sectionTitle, TermSelector, type SearchParams } from "../shared";

export const dynamic = "force-dynamic";

const querySchema = z.object({
	termId: z.string().max(60).optional(),
	q: z.string().trim().max(100).optional(),
	type: z.string().max(40).optional(),
});

export default async function EventsAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const params = querySchema.parse(firstParams(await searchParams));
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === params.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const rows = selectedTerm ? await createAttendanceReports(getDb()).termEventSummaries(actor, selectedTerm.id) : [];
	const filtered = archiveRows(rows, { q: params.q, type: params.type });
	const types = archiveTypes(rows, params.type);
	// Feedback is a planner's view: it needs the surveys surface on and the same permission as the survey admin pages.
	const showFeedback = isFeatureEnabled("surveys") && can(actor, "survey:configure");
	// A failed read degrades to dashes rather than taking the whole archive down.
	const feedback = showFeedback
		? await (await getRepositories()).surveyResults
				.feedbackForEvents(actor, filtered.map((row) => row.eventId))
				.catch(() => new Map<string, EventFeedbackRow>())
		: new Map<string, EventFeedbackRow>();
	const lines = filtered.map((row) => ({ row, cells: feedbackCells(feedback.get(row.eventId)) }));

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="font-heading text-3xl tracking-tight text-primary sm:text-4xl">Events</h1>
				<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">How each event turned out.</p>
			</header>

			<div className="flex flex-wrap items-end gap-3">
				{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} hidden={{ q: params.q, type: params.type }} /> : null}
				<form className="flex flex-wrap items-end gap-2" method="get">
					<input type="hidden" name="termId" value={selectedTerm?.id ?? ""} />
					<label className="grid min-w-56 gap-1 text-sm font-medium">
						Search
						<Input name="q" defaultValue={params.q ?? ""} />
					</label>
					{types.length > 0 ? (
						<label className="grid min-w-40 gap-1 text-sm font-medium">
							Type
							<Select name="type" defaultValue={params.type ?? ""} className="capitalize">
								<option value="">All types</option>
								{types.map((type) => (
									<option key={type} value={type}>
										{type}
									</option>
								))}
							</Select>
						</label>
					) : null}
					<Button type="submit" variant="secondary">
						<Search className="size-4" />
						Find
					</Button>
					{params.q || params.type ? <Button asChild variant="ghost"><Link href={archiveHref({ termId: selectedTerm?.id })}>Clear</Link></Button> : null}
				</form>
			</div>

			<section className="grid gap-3">
					{sectionTitle("Events")}
					<p className="text-sm text-muted-foreground sm:hidden">
						Swipe the table to see attendance{showFeedback ? ", points and feedback" : " and points"}.
					</p>
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className={`w-full text-left text-sm ${showFeedback ? "min-w-[1080px]" : "min-w-[760px]"}`}>
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Event</th>
									<th className="px-4 py-2.5 font-semibold">Date</th>
									<th className="px-4 py-2.5 font-semibold">Type</th>
									<th className="px-4 py-2.5 font-semibold">Status</th>
									<th className="px-4 py-2.5 text-right font-semibold">Attended</th>
									<th className="px-4 py-2.5 text-right font-semibold">Late</th>
									<th className="px-4 py-2.5 text-right font-semibold">Absent</th>
									<th className="px-4 py-2.5 text-right font-semibold">Points issued</th>
									{showFeedback ? (
										<>
											<th className="px-4 py-2.5 text-right font-semibold">Top-2 overall</th>
											<th className="px-4 py-2.5 text-right font-semibold">Responses</th>
											<th className="px-4 py-2.5 text-right font-semibold">Response rate</th>
											<th className="px-4 py-2.5 text-center font-semibold">Debrief</th>
										</>
									) : null}
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{filtered.length === 0 ? (
									<tr>
										<td className="px-4 py-2.5 text-muted-foreground" colSpan={showFeedback ? 12 : 8}>No events match. Clear the search or type to see all events.</td>
									</tr>
								) : (
									lines.map(({ row, cells }) => (
										<tr key={row.eventId}>
											<td className="min-w-0 px-4 py-2.5 font-medium">
												<Link href={`/portal/admin/data/events/${row.eventId}`} className="break-all text-primary underline-offset-4 hover:underline">
													{row.title}
												</Link>
											</td>
											<td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatDate(row.startsAt)}</td>
											<td className="px-4 py-2.5 capitalize">{row.type}</td>
											<td className="px-4 py-2.5 capitalize">{row.status}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.attendedCount}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.lateCount}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.absentCount}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.pointsIssued}</td>
											{showFeedback ? (
												<>
													<td className="px-4 py-2.5 text-right tabular-nums">{cells.topTwo}</td>
													<td className="px-4 py-2.5 text-right tabular-nums">{cells.responses}</td>
													<td className="px-4 py-2.5 text-right tabular-nums">{cells.rate}</td>
													<td className="px-4 py-2.5 text-center">
														{cells.debrief ? (
															<>
																<Check className="mx-auto size-4 text-primary" aria-hidden />
																<span className="sr-only">Debrief written</span>
															</>
														) : (
															"—"
														)}
													</td>
												</>
											) : null}
										</tr>
									))
								)}
							</tbody>
						</table>
					</CardContent>
				</Card>
			</section>
		</div>
	);
}
