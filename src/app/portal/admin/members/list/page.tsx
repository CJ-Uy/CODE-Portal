import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminIntro } from "@/components/portal/admin-intro";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { AddMembers } from "./add-members";
import { deleteMemberAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MemberListPage() {
	const actor = await requireActor();
	if (!can(actor, "member:manage")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const members = await repositories.members.list(actor, { limit: 50 });

	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Member List"
				whoFor="Official CODE members"
				effect="Adding an email lets that person sign in; they link automatically on first login"
			/>
			<Card>
				<CardHeader>
					<CardTitle>Member List ({members.length})</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-4">
					<AddMembers />
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((member) => (
								<TableRow key={member.id}>
									<TableCell className="font-medium">{member.fullName ?? member.name ?? member.nickname ?? "Invited member"}</TableCell>
									<TableCell>{member.email}</TableCell>
									<TableCell>
										<Badge variant={member.status === "active" ? "success" : member.status === "pending" ? "warn" : "outline"}>
											{member.status}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<form action={deleteMemberAction}>
											<input type="hidden" name="id" value={member.id} />
											<Button type="submit" variant="outline" size="sm" className="text-destructive" disabled={member.id === actor.memberId}>
												Delete
											</Button>
										</form>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
