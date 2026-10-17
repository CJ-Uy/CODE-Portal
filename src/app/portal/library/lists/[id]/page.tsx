import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ListPlus, Plus } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryCommentView } from "@/db/repositories/library";
import type { LibraryListView } from "@/db/repositories/library-lists";
import { ReportButton } from "@/components/library/report-button";
import { EmptyState } from "@/components/portal/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fullStopFor, relativeAge } from "@/lib/library/list-view";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { CopyLinkButton, DeleteListButton, DetailsForm, LeaveListButton, ShareControl } from "./list-controls";
import { ListComments } from "./list-comments";
import { ListEditor, type ListRow } from "./list-editor";
import { ListEditors } from "./list-editors";
import { ListModeration } from "./list-moderation";

export const dynamic = "force-dynamic";

/** An item the reader can open becomes a row with its card details; one they cannot becomes a bare placeholder. */
function toRows(list: LibraryListView, now: Date): ListRow[] {
	return list.items.map((item): ListRow => {
		if (!item.available) return { available: false, id: item.itemId };
		return {
			available: true,
			id: item.card.id,
			card: item.card,
			note: item.note,
			addedBy: item.addedByName,
			added: relativeAge(item.addedAt, now),
		};
	});
}

export default async function LibraryListPage({ params }: { params: Promise<{ id: string }> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const { id } = await params;

	const repositories = await getRepositories();
	// A list the reader may not open and one that does not exist look the same.
	const list = await repositories.libraryLists.getList(actor, id).catch(() => null);
	if (!list) notFound();
	const comments = await repositories.libraryLists.listComments(actor, id).catch((): LibraryCommentView[] => []);

	const canModerate = can(actor, "library:moderate");
	const isOwner = list.role === "owner";
	// A moderator reading a list they do not belong to has the role "viewer": they get the moderator controls and nothing that edits.
	const canEdit = list.role !== "viewer";
	const takenDown = Boolean(list.takenDownAt);
	const canComment = canEdit || (list.shared && !takenDown);
	const rows = toRows(list, new Date());

	return (
		<div className="mx-auto grid min-w-0 max-w-4xl gap-6">
			<Link href="/portal/library/lists" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Lists
			</Link>

			{takenDown ? (
				<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
					A library moderator took this list down
					{list.moderationReason ? (
						<>
							: <span className="break-all">{list.moderationReason}</span>
							{fullStopFor(list.moderationReason)}
						</>
					) : (
						"."
					)}
					{canEdit ? " It is not shared with members, and it stays that way until a moderator restores it." : ""}
				</p>
			) : null}
			{list.role === "viewer" && !list.shared && !takenDown ? (
				<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
					This list is private. You can read it because it has an open report.
				</p>
			) : null}

			<header className="grid min-w-0 gap-3">
				<div className="flex min-w-0 items-start gap-3">
					<span className="mt-3 size-4 shrink-0 rounded-full" style={{ backgroundColor: list.color }} aria-hidden />
					<h1 className="min-w-0 break-all font-heading text-3xl leading-tight">{list.name}</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{list.isDefault ? <Badge variant="outline">Your saved items</Badge> : null}
					{list.shared ? <Badge variant="secondary">Shared with members</Badge> : <Badge variant="outline">Private</Badge>}
					{list.pinned ? <Badge variant="info">Collection</Badge> : null}
					{takenDown ? <Badge variant="warn">Taken down</Badge> : null}
					<span className="text-xs text-muted-foreground">
						{list.items.length} {list.items.length === 1 ? "item" : "items"}
					</span>
				</div>
				{list.description.trim() ? <p className="min-w-0 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{list.description}</p> : null}
				<div className="grid min-w-0 gap-1 text-sm text-muted-foreground">
					<p className="min-w-0">
						Owner <span className="break-all font-medium text-foreground">{list.ownerName}</span>
					</p>
					{list.editors.length > 0 ? (
						<p className="min-w-0">
							Editors{" "}
							{list.editors.map((editor, index) => (
								<span key={editor.memberId}>
									{index > 0 ? ", " : ""}
									<span className="break-all font-medium text-foreground">{editor.name}</span>
								</span>
							))}
						</p>
					) : null}
				</div>

				<div className="flex flex-wrap items-center gap-2 pt-1">
					{canEdit ? (
						<Button asChild>
							<Link href={`/portal/library/new?list=${encodeURIComponent(list.id)}`}>
								<Plus aria-hidden />
								Add new item
							</Link>
						</Button>
					) : null}
					{!isOwner && list.shared && !takenDown ? <CopyLinkButton listId={list.id} /> : null}
					{!isOwner && list.shared && !takenDown ? <ReportButton listId={list.id} /> : null}
					{list.role === "editor" ? <LeaveListButton listId={list.id} memberId={actor.memberId} /> : null}
				</div>
			</header>

			{isOwner ? (
				<div className="grid min-w-0 gap-3">
					<ShareControl listId={list.id} shared={list.shared} takenDown={takenDown} />
					<details className="min-w-0 rounded-xl border border-border bg-card">
						<summary className="cursor-pointer rounded-xl px-4 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">List settings</summary>
						<div className="grid min-w-0 gap-6 border-t border-border p-4">
							<section aria-labelledby="list-details-title" className="grid min-w-0 gap-3">
								<h2 id="list-details-title" className="font-heading text-lg">
									Details
								</h2>
								<DetailsForm listId={list.id} name={list.name} description={list.description} color={list.color} />
							</section>
							<section aria-labelledby="list-editors-title" className="grid min-w-0 gap-3">
								<h2 id="list-editors-title" className="font-heading text-lg">
									Editors
								</h2>
								<ListEditors listId={list.id} ownerId={actor.memberId} editors={list.editors} />
							</section>
							<section aria-labelledby="list-delete-title" className="grid min-w-0 gap-3">
								<h2 id="list-delete-title" className="font-heading text-lg">
									Delete
								</h2>
								<DeleteListButton listId={list.id} isDefault={list.isDefault} />
							</section>
						</div>
					</details>
				</div>
			) : null}

			<section aria-labelledby="list-items-title" className="grid min-w-0 gap-3">
				<h2 id="list-items-title" className="font-heading text-xl">
					Items
				</h2>
				{rows.length === 0 ? (
					<EmptyState
						icon={ListPlus}
						title="Nothing in this list yet"
						description={
							canEdit
								? "Add a new item above, or open any library item and tap Save to put it here."
								: "Nobody has added anything to this list yet."
						}
					/>
				) : (
					<ListEditor listId={list.id} rows={rows} canEdit={canEdit} />
				)}
			</section>

			{canModerate ? (
				<ListModeration
					listId={list.id}
					shared={list.shared}
					pinned={list.pinned}
					pinOrder={list.pinOrder}
					takenDown={takenDown}
					// Taking a list down only works on a shared list or one with an open report. A moderator who is not a member can open an unshared list only for that reason.
					canTakeDown={list.shared || list.role === "viewer"}
				/>
			) : null}

			<ListComments listId={list.id} comments={comments} canComment={canComment} canModerate={canModerate} />
		</div>
	);
}
