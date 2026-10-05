import { notFound, redirect } from "next/navigation";
import { ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import type { LibraryItem } from "@/db/repositories/library";
import { createLibraryItemAction, deleteLibraryItemAction, updateLibraryItemAction } from "./actions";

export const dynamic = "force-dynamic";

const KINDS = ["article", "case_study"] as const;
const CONFIDENTIALITY = ["public", "members", "confidential"] as const;

function Fields({ item }: { item?: LibraryItem }) {
	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1 text-sm font-medium">
					Title
					<Input name="title" defaultValue={item?.title ?? ""} maxLength={200} required />
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Category
					<Input name="category" defaultValue={item?.category ?? "General"} maxLength={60} required />
				</label>
			</div>
			<div className="grid gap-3 sm:grid-cols-3">
				<label className="grid gap-1 text-sm font-medium">
					Kind
					<select name="kind" defaultValue={item?.kind ?? "article"} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
						{KINDS.map((kind) => (
							<option key={kind} value={kind}>
								{kind === "case_study" ? "Case study" : "Article"}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Confidentiality
					<select
						name="confidentiality"
						defaultValue={item?.confidentiality ?? "members"}
						className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
					>
						{CONFIDENTIALITY.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Reading time (minutes)
					<Input name="readMinutes" type="number" min={1} max={180} defaultValue={item?.readMinutes ?? 5} required />
				</label>
			</div>
			<label className="grid gap-1 text-sm font-medium">
				Summary (one line)
				<Input name="dek" defaultValue={item?.dek ?? ""} maxLength={400} />
			</label>
			<label className="grid gap-1 text-sm font-medium">
				Abstract
				<Textarea name="abstract" rows={3} defaultValue={item?.abstract ?? ""} />
			</label>
			<label className="grid gap-1 text-sm font-medium">
				Sections (one per line: Heading | Body)
				<Textarea name="sections" rows={3} defaultValue={(item?.sectionsJson ?? []).map((s) => `${s.heading} | ${s.body}`).join("\n")} />
			</label>
			<label className="grid gap-1 text-sm font-medium">
				Components (one per line: Name | Definition | Example)
				<Textarea
					name="components"
					rows={2}
					defaultValue={(item?.componentsJson ?? []).map((c) => `${c.name} | ${c.definition} | ${c.example}`).join("\n")}
				/>
			</label>
			<div className="grid gap-3 sm:grid-cols-3">
				<label className="grid gap-1 text-sm font-medium">
					Questions (one per line)
					<Textarea name="questions" rows={2} defaultValue={(item?.questionsJson ?? []).join("\n")} />
				</label>
				<label className="grid gap-1 text-sm font-medium">
					References (one per line)
					<Textarea name="references" rows={2} defaultValue={(item?.referencesJson ?? []).join("\n")} />
				</label>
				<label className="grid gap-1 text-sm font-medium">
					Topics (one per line)
					<Textarea name="topics" rows={2} defaultValue={(item?.topicsJson ?? []).join("\n")} />
				</label>
			</div>
		</>
	);
}

export default async function AdminLibraryPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "library:manage")) redirect("/portal");

	const repositories = await getRepositories();
	const items = await repositories.library.listAll(actor).catch(() => []);

	return (
		<div className="grid gap-6">
			<AdminIntro title="Library" whoFor="Publish and edit articles and case studies" effect="Saved items appear immediately for the audience you select" />
			<details className="rounded-xl border border-border/60 bg-card">
				<summary className="cursor-pointer rounded-xl px-5 py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">New library item</summary>
				<div className="border-t border-border/50 p-5">
					<form action={createLibraryItemAction} className="grid gap-4">
						<Fields />
						<div>
							<Button type="submit">
								<Plus />
								Publish item
							</Button>
						</div>
					</form>
				</div>
			</details>

			<div className="grid gap-4">
				<h2 className="font-heading text-xl">Items ({items.length})</h2>
				{items.length === 0 ? (
					<p className="text-sm text-muted-foreground">No library items yet.</p>
				) : (
					items.map((item) => (
						<details key={item.id} className="group/item rounded-xl border border-border/60 bg-card">
							<summary className="flex cursor-pointer list-none items-center gap-4 rounded-xl px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
								<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="secondary">{item.category}</Badge>
									<Badge variant="outline">{item.confidentiality}</Badge>
								</div>
								<span className="mt-2 block text-lg font-semibold">{item.title}</span>
								<span className="mt-1 block text-sm text-muted-foreground">Open to edit</span>
								</div>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/item:rotate-180 motion-reduce:transition-none" aria-hidden />
							</summary>
							<div className="border-t border-border/50 p-5">
								<form action={updateLibraryItemAction} className="grid gap-4">
									<input type="hidden" name="id" value={item.id} />
									<Fields item={item} />
									<div className="flex gap-2">
										<Button type="submit" variant="secondary" size="sm">
											<Save />
											Save changes
										</Button>
									</div>
								</form>
								<form action={deleteLibraryItemAction} className="mt-2">
									<input type="hidden" name="id" value={item.id} />
									<Button type="submit" variant="ghost" size="sm" className="text-destructive">
										<Trash2 />
										Delete
									</Button>
								</form>
							</div>
						</details>
					))
				)}
			</div>
		</div>
	);
}
