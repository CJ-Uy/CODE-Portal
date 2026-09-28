import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { createQuickLinkAction, deleteQuickLinkAction, updateQuickLinkAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function QuickLinksAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "nav:configure")) redirect("/portal/admin");
	const repositories = await getRepositories();
	// quick links has no shared-dev internal proxy yet; degrade to an empty list instead of crashing.
	const links = await repositories.quickLinks.list(actor).catch(() => []);

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Add a quick link</CardTitle>
					<CardDescription>Resources shown in the dashboard Quick Links widget.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createQuickLinkAction} className="grid gap-2 sm:grid-cols-4">
						<Input name="label" placeholder="Label" required />
						<Input name="url" type="url" placeholder="https://" required className="sm:col-span-2" />
						<Input name="position" type="number" defaultValue={0} min={0} required />
						<Button type="submit" className="sm:col-span-4">
							Add link
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Current links ({links.length})</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Position</TableHead>
								<TableHead>Label</TableHead>
								<TableHead>URL</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{links.map((link) => (
								<TableRow key={link.id}>
									<TableCell>
										<form action={updateQuickLinkAction} className="flex items-center gap-1">
											<input type="hidden" name="id" value={link.id} />
											<input type="hidden" name="label" value={link.label} />
											<input type="hidden" name="url" value={link.url} />
											<Input name="position" type="number" defaultValue={link.position} className="w-20" min={0} />
											<Button type="submit" size="sm" variant="outline">
												Save
											</Button>
										</form>
									</TableCell>
									<TableCell>{link.label}</TableCell>
									<TableCell className="max-w-xs truncate">{link.url}</TableCell>
									<TableCell className="text-right">
										<form action={deleteQuickLinkAction}>
											<input type="hidden" name="id" value={link.id} />
											<Button type="submit" size="sm" variant="outline">
												Remove
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
