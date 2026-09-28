import Link from "next/link";
import { Search } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db/client";
import { createAttendanceReports } from "@/db/repositories/attendance-reports";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { loadRetentionPickers } from "../retention/data";
import { firstParams, PAGE_SIZE, Pager, sectionTitle, TermSelector, type SearchParams } from "../shared";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
	termId: z.string().max(60).optional(),
	q: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function MembersAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const params = listQuerySchema.parse(firstParams(await searchParams));
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === params.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const rows = selectedTerm
		? await createAttendanceReports(getDb()).termMemberSummaries(actor, selectedTerm.id, {
				q: params.q,
				limit: PAGE_SIZE,
				offset: (params.page - 1) * PAGE_SIZE,
			})
		: [];
	const typeLabel = new Map(pickers.pointTypes.map((type) => [type.id, type.label]));
	const urlParams = new URLSearchParams();
	if (selectedTerm) urlParams.set("termId", selectedTerm.id);
	if (params.q) urlParams.set("q", params.q);
	urlParams.set("page", String(params.page));

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="font-heading text-3xl tracking-tight text-primary sm:text-4xl">Members</h1>
				<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Who is participating, and who is short.</p>
			</header>

			<div className="flex flex-wrap items-end gap-3">
				{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} hidden={{ q: params.q }} /> : null}
				<form className="flex flex-wrap items-end gap-2" method="get">
					<input type="hidden" name="termId" value={selectedTerm?.id ?? ""} />
					<label className="grid min-w-56 gap-1 text-sm font-medium">
						Search
						<Input name="q" defaultValue={params.q ?? ""} />
					</label>
					<Button type="submit" variant="secondary">
						<Search className="size-4" />
						Find
					</Button>
					{params.q ? <Button asChild variant="ghost"><Link href={`/portal/admin/data/members?termId=${selectedTerm?.id ?? ""}`}>Clear</Link></Button> : null}
				</form>
			</div>

			<section className="grid gap-3">
				{sectionTitle("Members")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[760px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Member</th>
									<th className="px-4 py-2.5 text-right font-semibold">Events attended</th>
									<th className="px-4 py-2.5 text-right font-semibold">Late count</th>
									<th className="px-4 py-2.5 font-semibold">Points by type</th>
									<th className="px-4 py-2.5 text-right font-semibold">Total</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{rows.length === 0 ? (
									<tr><td className="px-4 py-2.5 text-muted-foreground" colSpan={5}>{params.q ? "No members match that search. Clear the search to see all members." : "No member attendance or points yet. Record points or scan attendance to populate this list."}</td></tr>
								) : rows.map((row) => {
									const entries = Object.entries(row.pointsByType).filter(([, points]) => points !== 0);
									const total = entries.reduce((sum, [, points]) => sum + points, 0);
									return (
										<tr key={row.memberId}>
											<td className="min-w-0 px-4 py-2.5">
												<Link href={`/portal/admin/members/${row.memberId}?termId=${selectedTerm?.id ?? ""}`} className="break-all font-medium text-primary underline-offset-4 hover:underline">{row.memberName ?? "Member"}</Link>
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.attendedCount}</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{row.lateCount}</td>
											<td className="min-w-0 px-4 py-2.5">
												{entries.length === 0 ? <span className="text-muted-foreground">No points</span> : entries.map(([id, points]) => <span key={id} className="mr-3 inline-block break-all tabular-nums">{typeLabel.get(id) ?? id}: {points}</span>)}
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums">{total}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</CardContent>
				</Card>
				<Pager basePath="/portal/admin/data/members" params={urlParams} page={params.page} hasNext={rows.length === PAGE_SIZE} />
			</section>
		</div>
	);
}
