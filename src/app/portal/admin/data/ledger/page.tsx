import Link from "next/link";
import { Search } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { loadRetentionPickers } from "../retention/data";
import { firstParams, formatDateTime, PAGE_SIZE, Pager, sectionTitle, TermSelector, type SearchParams } from "../shared";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
	termId: z.string().max(60).optional(),
	q: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function LedgerAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) notFound();
	const params = listQuerySchema.parse(firstParams(await searchParams));
	const pickers = await loadRetentionPickers(actor);
	const now = new Date();
	const selectedTerm =
		pickers.terms.find((term) => term.id === params.termId) ??
		pickers.terms.find((term) => term.startsAt <= now && term.endsAt >= now) ??
		pickers.terms[0];
	const repositories = await getRepositories();
	const rows = selectedTerm
		? await repositories.retention.listForTerm(actor, selectedTerm.id, {
				q: params.q,
				limit: PAGE_SIZE,
				offset: (params.page - 1) * PAGE_SIZE,
			})
		: [];
	const urlParams = new URLSearchParams();
	if (selectedTerm) urlParams.set("termId", selectedTerm.id);
	if (params.q) urlParams.set("q", params.q);
	urlParams.set("page", String(params.page));

	return (
		<div className="grid gap-5">
			<header className="border-b border-border pb-5">
				<h1 className="font-heading text-3xl tracking-tight text-primary sm:text-4xl">Ledger</h1>
				<p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Where every point came from.</p>
			</header>

			<div className="flex flex-wrap items-end gap-3">
				{selectedTerm ? <TermSelector terms={pickers.terms} selectedTermId={selectedTerm.id} hidden={{ q: params.q }} /> : null}
				<form className="flex flex-wrap items-end gap-2" method="get">
					<input type="hidden" name="termId" value={selectedTerm?.id ?? ""} />
					<label className="grid min-w-56 gap-1 text-sm font-medium">
						Search
						<Input name="q" defaultValue={params.q ?? ""} />
					</label>
					<Button type="submit" variant="secondary"><Search className="size-4" />Find</Button>
					{params.q ? <Button asChild variant="ghost"><Link href={`/portal/admin/data/ledger?termId=${selectedTerm?.id ?? ""}`}>Clear</Link></Button> : null}
				</form>
			</div>

			<section className="grid gap-3">
				{sectionTitle("Point records")}
				<Card>
					<CardContent className="overflow-x-auto p-0">
						<table className="w-full min-w-[860px] text-left text-sm">
							<thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5 font-semibold">Recorded</th>
									<th className="px-4 py-2.5 font-semibold">Member</th>
									<th className="px-4 py-2.5 font-semibold">Point type</th>
									<th className="px-4 py-2.5 font-semibold">Source</th>
									<th className="px-4 py-2.5 font-semibold">Reason</th>
									<th className="px-4 py-2.5 text-right font-semibold">Points</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{rows.length === 0 ? (
									<tr><td className="px-4 py-2.5 text-muted-foreground" colSpan={6}>{params.q ? "No records match that search. Clear the search to see the ledger." : "No point records yet. Add a manual record or scan attendance to populate the ledger."}</td></tr>
								) : rows.map((row) => (
									<tr key={row.recordId}>
										<td className="px-4 py-2.5 tabular-nums text-muted-foreground">{formatDateTime(row.recordedAt)}</td>
										<td className="min-w-0 px-4 py-2.5"><Link href={`/portal/admin/members/${row.memberId}?termId=${selectedTerm?.id ?? ""}`} className="break-all font-medium text-primary underline-offset-4 hover:underline">{row.memberName ?? "Member"}</Link></td>
										<td className="min-w-0 break-all px-4 py-2.5">{row.pointTypeLabel}</td>
										<td className="px-4 py-2.5 capitalize">{row.source.replaceAll("_", " ")}</td>
										<td className="min-w-0 break-all px-4 py-2.5">{row.eventTitle ?? row.reason}</td>
										<td className="px-4 py-2.5 text-right tabular-nums">{row.points ?? 0}</td>
									</tr>
								))}
							</tbody>
						</table>
					</CardContent>
				</Card>
				<Pager basePath="/portal/admin/data/ledger" params={urlParams} page={params.page} hasNext={rows.length === PAGE_SIZE} />
			</section>
		</div>
	);
}
