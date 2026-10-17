import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { Bookmark, Layers, ListPlus, Users } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryListSummary } from "@/db/repositories/library-lists";
import { EmptyState } from "@/components/portal/empty-state";
import { Badge } from "@/components/ui/badge";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { NewListForm } from "./new-list-form";

export const dynamic = "force-dynamic";

function ListRow({ list }: { list: LibraryListSummary }) {
	return (
		<li className="min-w-0">
			<Link
				href={`/portal/library/lists/${list.id}`}
				className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="mt-1 size-4 shrink-0 rounded-full" style={{ backgroundColor: list.color }} aria-hidden />
				<div className="grid min-w-0 flex-1 gap-1">
					<p className="min-w-0 [overflow-wrap:anywhere] font-medium">{list.name}</p>
					{list.description.trim() ? <p className="line-clamp-2 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{list.description}</p> : null}
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span>
							{list.itemCount} {list.itemCount === 1 ? "item" : "items"}
						</span>
						{list.takenDownAt ? <Badge variant="warn">Taken down</Badge> : list.shared ? <Badge variant="secondary">Shared</Badge> : null}
						{list.pinned && !list.takenDownAt ? <Badge variant="info">Collection</Badge> : null}
					</div>
				</div>
			</Link>
		</li>
	);
}

export default async function LibraryListsPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const repositories = await getRepositories();
	const [{ owned, editable }, collections] = await Promise.all([
		repositories.libraryLists.myLists(actor).catch(() => ({ owned: [] as LibraryListSummary[], editable: [] as LibraryListSummary[] })),
		repositories.libraryLists.collections(actor).catch((): LibraryListSummary[] => []),
	]);
	// Saved is made the first time something is saved; until then it is described, not linked.
	const hasSaved = owned.some((list) => list.isDefault);

	return (
		<div className="mx-auto grid min-w-0 max-w-4xl gap-8">
			<div className="grid min-w-0 gap-1">
				<Link href="/portal/library" className="w-fit text-sm text-muted-foreground hover:text-foreground">
					&larr; Library
				</Link>
				<h1 className="font-heading text-3xl">Lists</h1>
				<p className="max-w-2xl text-sm text-muted-foreground">Keep library items together, share a reading pack with members, or edit one with others.</p>
			</div>

			<section aria-labelledby="my-lists-title" className="grid min-w-0 gap-3">
				<h2 id="my-lists-title" className="flex items-center gap-2 font-heading text-xl">
					<Bookmark className="size-5 text-accent" aria-hidden />
					My lists
				</h2>
				<NewListForm />
				<ul className="grid gap-2 sm:grid-cols-2">
					{!hasSaved ? (
						<li className="min-w-0 rounded-xl border border-dashed border-border p-3">
							<p className="font-medium">Saved</p>
							<p className="text-sm text-muted-foreground">Nothing saved yet. Tap Save on any library item and it will be here.</p>
						</li>
					) : null}
					{owned.map((list) => (
						<ListRow key={list.id} list={list} />
					))}
				</ul>
			</section>

			<section aria-labelledby="shared-lists-title" className="grid min-w-0 gap-3">
				<h2 id="shared-lists-title" className="flex items-center gap-2 font-heading text-xl">
					<Users className="size-5 text-accent" aria-hidden />
					Shared with me
				</h2>
				{editable.length === 0 ? (
					<EmptyState icon={ListPlus} title="No shared lists yet" description="When a member makes you an editor of their list, it shows up here." />
				) : (
					<ul className="grid gap-2 sm:grid-cols-2">
						{editable.map((list) => (
							<ListRow key={list.id} list={list} />
						))}
					</ul>
				)}
			</section>

			<section aria-labelledby="collections-title" className="grid min-w-0 gap-3">
				<h2 id="collections-title" className="flex items-center gap-2 font-heading text-xl">
					<Layers className="size-5 text-accent" aria-hidden />
					Collections
				</h2>
				{collections.length === 0 ? (
					<EmptyState icon={Layers} title="No collections yet" description="Library moderators pin shared lists here as collections." />
				) : (
					<ul className="grid gap-2 sm:grid-cols-2">
						{collections.map((list) => (
							<ListRow key={list.id} list={list} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
