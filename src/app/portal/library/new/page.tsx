import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryFormat, LibraryKind } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { StartCard } from "./start-card";

export const dynamic = "force-dynamic";

// The kinds each path offers (the first is pre-selected). A Case study can be uploaded or written; a Book/paper uploaded or linked.
const PATHS: { format: LibraryFormat; kinds: LibraryKind[] }[] = [
	{ format: "file", kinds: ["code_document", "template", "reading", "case_study"] },
	{ format: "page", kinds: ["guide", "article", "framework", "case_study"] },
	{ format: "link", kinds: ["website", "reading"] },
];

export default async function NewLibraryItemPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const { list } = await searchParams;

	// A list is only offered when the member can edit it; the action checks again, this just says so.
	const repositories = await getRepositories();
	const lists = list ? await repositories.libraryLists.myLists(actor).catch(() => ({ owned: [], editable: [] })) : null;
	const target = lists ? [...lists.owned, ...lists.editable].find((candidate) => candidate.id === list) : undefined;

	return (
		<div className="mx-auto grid max-w-6xl gap-6">
			<Link href="/portal/library" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Back to library
			</Link>
			<div>
				<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
				<h1 className="font-heading text-3xl">Add to the library</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Start a draft first. Nothing is shared until you publish it, and you can keep working on it as long as you like.
				</p>
				{target ? (
					<p className="mt-3 min-w-0 max-w-2xl break-all rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">
						It will also be added to your list <span className="font-medium">{target.name}</span>.
					</p>
				) : null}
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				{PATHS.map((path) => (
					<StartCard key={path.format} format={path.format} kinds={path.kinds} listId={target?.id ?? ""} />
				))}
			</div>
		</div>
	);
}
