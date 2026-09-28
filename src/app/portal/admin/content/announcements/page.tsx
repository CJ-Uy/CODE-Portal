import { notFound, redirect } from "next/navigation";
import { Pin, Plus, Trash2 } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { createAnnouncementAction, deleteAnnouncementAction, updateAnnouncementAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
	if (!isFeatureEnabled("announcements")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "announcement:manage")) redirect("/portal");

	const repositories = await getRepositories();
	const items = await repositories.announcements.listAll(actor).catch(() => []);

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader>
					<CardTitle>New announcement</CardTitle>
					<CardDescription>Posts appear in every member&apos;s feed. Pinned posts stay at the top.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createAnnouncementAction} className="grid gap-4">
						<div className="grid gap-4 sm:grid-cols-[160px_1fr]">
							<label className="grid gap-2 text-sm font-medium">
								Tag
								<Input name="tag" defaultValue="CODE" maxLength={24} required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Title
								<Input name="title" placeholder="Announcement title" maxLength={160} required />
							</label>
						</div>
						<label className="grid gap-2 text-sm font-medium">
							Body
							<Textarea name="body" rows={5} placeholder="Write the announcement. Blank lines start new paragraphs." required />
						</label>
						<div className="flex flex-wrap items-center gap-6">
							<label className="grid gap-2 text-sm font-medium">
								Audience label
								<Input name="audience" defaultValue="All members" maxLength={80} required />
							</label>
							<label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
								<Checkbox name="pinned" />
								Pin to top
							</label>
						</div>
						<div>
							<Button type="submit">
								<Plus />
								Publish
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<div className="grid gap-4">
				<h2 className="font-heading text-xl">Published ({items.length})</h2>
				{items.length === 0 ? (
					<p className="text-sm text-muted-foreground">No announcements yet.</p>
				) : (
					items.map((item) => (
						<Card key={item.id}>
							<CardHeader>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="info">{item.tag}</Badge>
									{item.pinned ? (
										<Badge variant="secondary" className="gap-1">
											<Pin className="size-3" />
											Pinned
										</Badge>
									) : null}
								</div>
								<CardTitle className="text-lg">{item.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<form action={updateAnnouncementAction} className="grid gap-3">
									<input type="hidden" name="id" value={item.id} />
									<div className="grid gap-3 sm:grid-cols-[160px_1fr]">
										<Input name="tag" defaultValue={item.tag} maxLength={24} required aria-label="Tag" />
										<Input name="title" defaultValue={item.title} maxLength={160} required aria-label="Title" />
									</div>
									<Textarea name="body" rows={4} defaultValue={item.body} required aria-label="Body" />
									<div className="flex flex-wrap items-center gap-6">
										<Input name="audience" defaultValue={item.audience} maxLength={80} required aria-label="Audience" className="max-w-60" />
										<label className="flex items-center gap-2 text-sm font-medium">
											<Checkbox name="pinned" defaultChecked={item.pinned} />
											Pinned
										</label>
									</div>
									<div className="flex gap-2">
										<Button type="submit" variant="secondary" size="sm">
											Save changes
										</Button>
									</div>
								</form>
								<form action={deleteAnnouncementAction} className="mt-2">
									<input type="hidden" name="id" value={item.id} />
									<Button type="submit" variant="ghost" size="sm" className="text-destructive">
										<Trash2 />
										Delete
									</Button>
								</form>
							</CardContent>
						</Card>
					))
				)}
			</div>
		</div>
	);
}
