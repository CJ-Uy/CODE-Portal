import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminIntro } from "@/components/portal/admin-intro";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { AddMembers } from "./add-members";
import { deleteMemberAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MemberListPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "member:manage")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const params = await searchParams;
	const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
	const requestedPage = Number(params.page);
	const { members, total, page, pageSize } = await repositories.members.listPage(actor, {
		q,
		page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
	});
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const pageHref = (nextPage: number) => {
		const next = new URLSearchParams({ page: String(nextPage) });
		if (q) next.set("q", q);
		return `/portal/admin/members/list?${next}`;
	};

	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Member List"
				whoFor="Official CODE members"
				effect="Adding an email lets that person sign in; they link automatically on first login"
			/>
			<section className="grid gap-3 border-b border-border/60 pb-5" aria-labelledby="add-members-title">
				<h2 id="add-members-title" className="text-xl font-semibold text-primary">Add members</h2>
					<AddMembers />
			</section>
			<section aria-labelledby="member-directory-title" className="grid gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="member-directory-title" className="text-xl font-semibold text-primary">Member directory <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">({total})</span></h2>
					<form method="get" className="flex flex-wrap items-center gap-2">
						<label className="relative min-w-0 flex-1 sm:w-72">
							<span className="sr-only">Search members</span>
							<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
							<Input name="q" defaultValue={q} maxLength={100} placeholder="Search name, email, or status" className="pl-9" />
						</label>
						<Button type="submit" size="sm"><Search className="size-4" /> Search</Button>
						{q ? <Button asChild type="button" size="sm" variant="ghost"><Link href="/portal/admin/members/list">Clear</Link></Button> : null}
					</form>
				</div>
				<div className="min-w-0 rounded-xl border border-border/60 bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead className="hidden md:table-cell">Email</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.length === 0 ? (
								<TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">{q ? "No members match that search." : "No members yet."}</TableCell></TableRow>
							) : null}
							{members.map((member) => (
								<TableRow key={member.id}>
									<TableCell className="max-w-40 font-medium">{member.fullName ?? member.name ?? member.nickname ?? "Invited member"}<span className="mt-1 block break-all text-xs font-normal text-muted-foreground md:hidden">{member.email}</span></TableCell>
									<TableCell className="hidden break-all md:table-cell">{member.email}</TableCell>
									<TableCell>
										<Badge variant={member.status === "active" ? "success" : member.status === "pending" ? "warn" : "outline"}>
											{member.status}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<form action={deleteMemberAction}>
											<input type="hidden" name="id" value={member.id} />
											<Button type="submit" variant="outline" size="sm" className="text-destructive" disabled={member.id === actor.memberId}>
												<Trash2 className="size-4" />
												Delete
											</Button>
										</form>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
					<nav aria-label="Member pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
						<p>{total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : "0 members"}</p>
						<div className="flex items-center gap-2">
							{page > 1 ? <Button asChild size="sm" variant="outline"><Link href={pageHref(page - 1)}><ChevronLeft className="size-4" /> Previous</Link></Button> : <Button size="sm" variant="outline" disabled><ChevronLeft className="size-4" /> Previous</Button>}
							<span className="whitespace-nowrap">Page {page} of {pageCount}</span>
							{page < pageCount ? <Button asChild size="sm" variant="outline"><Link href={pageHref(page + 1)}>Next <ChevronRight className="size-4" /></Link></Button> : <Button size="sm" variant="outline" disabled>Next <ChevronRight className="size-4" /></Button>}
						</div>
					</nav>
			</section>
		</div>
	);
}
