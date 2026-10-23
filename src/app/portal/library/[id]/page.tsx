import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { ExternalLink, FileText, Lock, Pencil } from "lucide-react";
import { getRepositories } from "@/db";
import { LINK_URL, type LibraryCard, type LibraryCommentView, type LibraryItemView } from "@/db/repositories/library";
import { DownloadLink } from "@/components/library/download-link";
import { LibraryItemCard } from "@/components/library/library-card";
import { LibraryBlocks } from "@/components/library/library-blocks";
import { BackToLibrary } from "@/components/library/back-to-library";
import { CopyLinkButton } from "@/components/library/copy-link-button";
import { LibraryCrumbs } from "@/components/library/library-header";
import { ReadingTracker } from "@/components/library/reading-tracker";
import { ReportButton } from "@/components/library/report-button";
import { SavePicker } from "@/components/library/save-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statsLine } from "@/lib/library/activity";
import { embeddedItemIds, paragraphs } from "@/lib/library/block-view";
import { filePreview, formatFileSize, libraryFileHref } from "@/lib/library/file-link";
import { KIND_LABELS, READINESS_LABELS, SOURCE_LABELS } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { getLibraryAi } from "@/server/library/ai";
import { smartRelated, smartSearchPreference } from "@/server/library/smart-search";
import { CommentForm, HideCommentButton } from "./comment-form";
import { FlagClientDataButton } from "./flag-button";
import { ModeratorPanel } from "./moderator-panel";

export const dynamic = "force-dynamic";

type Repositories = Awaited<ReturnType<typeof getRepositories>>;

// Search takes at most 100 ids at a time.
const EMBED_CHUNK = 100;
const WHEN = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" });
const OFFICE_CHIP = { word: "Word", powerpoint: "PowerPoint", excel: "Excel" } as const;

/** Every embedded id gets an answer: its card, or null ("Not available") when it is hidden from this reader or gone. */
async function loadEmbeds(actor: Actor, repositories: Repositories, item: LibraryItemView): Promise<Map<string, LibraryCard | null>> {
	const ids = item.format === "page" ? embeddedItemIds(item.blocksJson) : [];
	const found = new Map<string, LibraryCard>();
	for (let start = 0; start < ids.length; start += EMBED_CHUNK) {
		const chunk = ids.slice(start, start + EMBED_CHUNK);
		const { cards } = await repositories.library.search(actor, { onlyIds: chunk, limit: chunk.length }).catch(() => ({ cards: [] as LibraryCard[] }));
		for (const card of cards) found.set(card.id, card);
	}
	return new Map(ids.map((id) => [id, found.get(id) ?? null]));
}

/** Similar by meaning when smart search is on for this member and the item is indexed; otherwise (or on any failure) the shared-tags shelf. */
async function loadRelated(actor: Actor, repositories: Repositories, id: string): Promise<LibraryCard[]> {
	const smart = getLibraryAi();
	const ids = smart && (await smartSearchPreference(repositories.members, actor)) ? await smartRelated(actor, id, { ...smart, repos: repositories }) : null;
	if (ids?.length) return repositories.library.search(actor, { onlyIds: ids, sort: "relevance", limit: ids.length }).then(({ cards }) => cards, () => []);
	if (ids) return [];
	return repositories.library.related(actor, id, 6).catch((): LibraryCard[] => []);
}

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	const { id } = await params;

	const repositories = await getRepositories();
	// The extras may fail without taking the item down with them. Those that need only the id start
	// with the item read; on a hidden or missing item they are simply thrown away.
	const extras = Promise.all([
		repositories.library.listComments(actor, id).catch((): LibraryCommentView[] => []),
		repositories.libraryActivity.statsFor([id]).then((all) => all.get(id) ?? null).catch(() => null),
		repositories.libraryLists.myLists(actor).catch(() => ({ owned: [], editable: [] })),
		repositories.libraryLists.savedIn(actor, id).catch((): string[] => []),
		loadRelated(actor, repositories, id).catch((): LibraryCard[] => []),
	]);
	// A hidden item and a missing one look the same: nothing here says which it was.
	const item = await repositories.library.getItem(actor, id).catch(() => null);
	if (!item) notFound();

	const canModerate = can(actor, "library:moderate");
	const canManage = can(actor, "library:manage");
	const isOwner = item.createdBy === actor.memberId;
	const live = item.status === "published";

	const [[comments, liveStats, lists, savedIn, related], embeds] = await Promise.all([extras, loadEmbeds(actor, repositories, item)]);
	const stats = live ? liveStats : null;

	const topLevel = comments.filter((comment) => !comment.parentId);
	const visibleComments = comments.filter((comment) => !comment.hidden).length;
	const repliesByParent = new Map<string, LibraryCommentView[]>();
	for (const comment of comments) {
		if (comment.parentId) repliesByParent.set(comment.parentId, [...(repliesByParent.get(comment.parentId) ?? []), comment]);
	}

	const file = item.format === "file" && item.fileKey ? { key: item.fileKey, name: item.fileName } : null;
	const preview = file ? filePreview(file) : null;
	// Labelled where a bare value would not say what it is ("SLE", "C-Team", or a kind of document called "Other").
	const facts = [
		item.year ? String(item.year) : null,
		item.subtype ? `Kind: ${item.subtype}` : null,
		item.formatDetail ? `Format: ${item.formatDetail}` : null,
		item.engagementType ? `Engagement: ${item.engagementType}` : null,
	].filter((fact): fact is string => fact !== null);

	return (
		<div className="mx-auto grid min-w-0 max-w-4xl gap-6">
			{live ? <ReadingTracker key={item.id} itemId={item.id} /> : null}

			<LibraryCrumbs trail={[{ label: item.title }]} />

			<StatusNote item={item} />

			<header className="grid min-w-0 gap-3">
				<h1 className="min-w-0 font-heading text-3xl leading-tight [overflow-wrap:anywhere]">{item.title}</h1>
				{/* What it is, in one quiet line. The type is a way to more of the same kind. */}
				<p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
					<Link href={`/portal/library?type=${item.kind}`} className="font-medium text-foreground underline-offset-4 hover:underline">
						{KIND_LABELS[item.kind]}
					</Link>
					<span aria-hidden>·</span>
					<span>{SOURCE_LABELS[item.source]}</span>
					{item.format === "page" ? (
						<>
							<span aria-hidden>·</span>
							<span>{item.readMinutes} min read</span>
						</>
					) : null}
					{item.confidentiality === "confidential" ? (
						<>
							<span aria-hidden>·</span>
							<span className="inline-flex items-center gap-1 font-medium text-foreground">
								<Lock className="size-3.5" aria-hidden />
								Confidential
							</span>
						</>
					) : null}
					{item.publicReadiness ? (
						<>
							<span aria-hidden>·</span>
							<span>{READINESS_LABELS[item.publicReadiness]}</span>
						</>
					) : null}
				</p>
				{item.dek.trim() ? (
					<div className="grid min-w-0 max-w-[65ch] gap-2 text-lg text-muted-foreground">
						{paragraphs(item.dek).map((part, index) => (
							<p key={index} className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">
								{part}
							</p>
						))}
					</div>
				) : null}

				{item.authors.length > 0 ? (
					<ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Authors">
						{item.authors.map((author, index) => (
							<li key={`${author.name}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
								<span className="min-w-0 [overflow-wrap:anywhere] font-medium">{author.name}</span>
								{author.stillInCode ? <Badge variant="info">Still in CODE</Badge> : null}
							</li>
						))}
					</ul>
				) : null}
				{facts.length > 0 ? <p className="min-w-0 [overflow-wrap:anywhere] text-sm text-muted-foreground">{facts.join(" · ")}</p> : null}
				{item.tags.length > 0 ? (
					// Each tag opens the library filtered to it, so a topic is one tap from everything else on it.
					<ul className="flex flex-wrap gap-1.5" aria-label="Tags: each opens everything with that tag">
						{item.tags.map((tag) => (
							<li key={tag.id} className="min-w-0">
								<Link
									href={`/portal/library?tag=${encodeURIComponent(tag.id)}`}
									className="inline-flex min-h-8 max-w-full items-center rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground [overflow-wrap:anywhere] transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{tag.name}
								</Link>
							</li>
						))}
					</ul>
				) : null}
				{item.clientDataRedacted ? (
					<p className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
						<span className="font-medium">Client details removed.</span> Names and details that could identify a client were taken out of this document.
					</p>
				) : null}

				{/* The things a reader does here. Reporting and flagging are rare, so they wait at the foot of the page. */}
				<div className="flex flex-wrap items-start gap-2 pt-1">
					<SavePicker itemId={item.id} lists={[...lists.owned, ...lists.editable]} savedIn={savedIn} />
					{file && preview === "pdf" ? <DownloadLink itemId={item.id} href={libraryFileHref(file, { download: true })} /> : null}
					{item.format === "link" && item.url && LINK_URL.test(item.url) ? (
						<Button asChild variant="outline">
							<a href={item.url} target="_blank" rel="noopener noreferrer">
								<ExternalLink aria-hidden />
								Open site
							</a>
						</Button>
					) : null}
					{live ? <CopyLinkButton path={`/portal/library/${item.id}`} /> : null}
					{item.canEdit ? (
						<Button asChild variant="ghost">
							<Link href={`/portal/library/${item.id}/edit`}>
								<Pencil aria-hidden />
								Edit
							</Link>
						</Button>
					) : null}
				</div>

				{stats ? <p className="min-w-0 text-sm text-muted-foreground">{statsLine(stats).join(" · ")}</p> : null}
			</header>

			<div className="min-w-0">
				{item.format === "file" ? <FileBody item={item} /> : null}
				{item.format === "link" ? <LinkBody url={item.url} /> : null}
				{item.format === "page" ? <LibraryBlocks blocks={item.blocksJson} embeds={embeds} /> : null}
			</div>

			{canModerate ? (
				<ModeratorPanel
					itemId={item.id}
					title={item.title}
					status={item.status}
					publicReadiness={item.publicReadiness}
					confidentiality={item.confidentiality}
					canManage={canManage}
					hasOwner={item.createdBy !== null}
				/>
			) : null}

			{/* What to read next comes before the discussion: most readers finish here and look for the next thing. */}
			{related.length > 0 ? (
				<section aria-labelledby="related-title" className="grid min-w-0 gap-3">
					<h2 id="related-title" className="font-heading text-xl">
						Related
					</h2>
					<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{related.map((card) => (
							<li key={card.id} className="min-w-0">
								<LibraryItemCard card={card} compact />
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section aria-labelledby="discussion-title" className="grid min-w-0 gap-4">
				<div className="grid gap-1">
					<h2 id="discussion-title" className="font-heading text-xl">
						Discussion{visibleComments > 0 ? ` (${visibleComments})` : ""}
					</h2>
					{visibleComments === 0 ? <p className="text-sm text-muted-foreground">No comments yet. Ask a question, or say how you used it.</p> : null}
				</div>
				<div className="grid gap-3">
					{topLevel.map((comment) => (
						<div key={comment.id} className="grid gap-2">
							<CommentRow comment={comment} itemId={item.id} canModerate={canModerate} />
							{(repliesByParent.get(comment.id) ?? []).map((reply) => (
								<div key={reply.id} className="ml-4 min-w-0 sm:ml-6">
									<CommentRow comment={reply} itemId={item.id} canModerate={canModerate} />
								</div>
							))}
							<details className="ml-4 min-w-0 text-sm sm:ml-6">
								<summary className="flex min-h-11 w-fit cursor-pointer items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
									Reply
								</summary>
								<div className="mt-2">
									<CommentForm itemId={item.id} parentId={comment.id} label="Reply" placeholder="Write a reply" />
								</div>
							</details>
						</div>
					))}
				</div>
				<div className="rounded-xl border border-border bg-card p-4">
					<CommentForm itemId={item.id} label="Comment" placeholder="Add a comment" />
				</div>
			</section>

			{/* The foot of a long page: the way back without scrolling up, and the rare actions. */}
			<footer className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
				<BackToLibrary className="inline-flex min-h-11 items-center gap-1.5 rounded-md font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" label="Back to the library" />
				<div className="flex flex-wrap items-center gap-1 text-muted-foreground">
					{item.canEdit && live ? <FlagClientDataButton itemId={item.id} /> : null}
					{isOwner ? null : <ReportButton itemId={item.id} />}
				</div>
			</footer>
		</div>
	);
}

/** What a draft, a waiting item or a taken-down item is, for the people who can see one. A moderator's reason is free text, so it breaks anywhere. */
function StatusNote({ item }: { item: LibraryItemView }) {
	if (item.status === "published") return null;
	const reason = item.moderationReason;
	let text: string;
	if (item.status === "pending_review") text = "Waiting for a library moderator to approve it. Other members cannot see it yet.";
	else if (item.status === "taken_down") text = `A library moderator took this down${reason ? `: ${reason}` : "."}`;
	else if (reason) text = `A library moderator sent this back: ${reason}`;
	else text = "A draft. Only its owner and library moderators can see it.";
	return (
		<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
			{text}
		</p>
	);
}

function FileBody({ item }: { item: LibraryItemView }) {
	if (!item.fileKey) {
		return <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">The file for this item is not available.</p>;
	}
	const file = { key: item.fileKey, name: item.fileName };
	const preview = filePreview(file);

	if (preview === "pdf") {
		const href = libraryFileHref(file);
		return (
			<div className="grid gap-3">
				{/* Phones often will not draw a PDF inside a page, so they get a plain way to open it. */}
				<Button asChild className="md:hidden">
					<a href={href} target="_blank" rel="noopener noreferrer">
						<FileText aria-hidden />
						Open PDF
					</a>
				</Button>
				<iframe
					src={href}
					title={`PDF preview: ${item.title}`}
					className="h-[calc(100dvh-7rem)] min-h-[26rem] w-full rounded-xl border border-border bg-card"
				/>
			</div>
		);
	}

	const kind = preview === "other" ? "File" : OFFICE_CHIP[preview];
	const size = formatFileSize(item.fileBytes);
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-5">
			<FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
			<div className="grid min-w-0 flex-1 gap-1">
				<div>
					<Badge variant="secondary">{kind}</Badge>
				</div>
				<p className="min-w-0 break-all font-medium">{item.fileName || item.fileKey.slice(item.fileKey.lastIndexOf("/") + 1)}</p>
				<p className="text-sm text-muted-foreground">{size ? `${size}. ` : ""}This file does not open in the browser. Download it to read it.</p>
			</div>
			<DownloadLink itemId={item.id} href={libraryFileHref(file, { download: true })} className="bg-primary text-primary-foreground hover:bg-primary/90" />
		</div>
	);
}

function LinkBody({ url }: { url: string | null }) {
	const host = (() => {
		try {
			return url ? new URL(url).hostname : "";
		} catch {
			return url ?? "";
		}
	})();
	const box = "flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-5";
	const content = (
		<>
			<ExternalLink className="size-8 shrink-0 text-muted-foreground" aria-hidden />
			<div className="grid min-w-0 flex-1 gap-1">
				<p className="font-heading text-xl">Open site</p>
				<p className="min-w-0 break-all text-sm text-muted-foreground">{host || "No link yet"}</p>
			</div>
		</>
	);
	// Stored links are checked on save; this only stops a corrupt row from becoming a javascript: link.
	if (!url || !LINK_URL.test(url)) return <div className={box}>{content}</div>;
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className={`${box} transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
		>
			{content}
		</a>
	);
}

function CommentRow({ comment, itemId, canModerate }: { comment: LibraryCommentView; itemId: string; canModerate: boolean }) {
	return (
		<div className={`min-w-0 rounded-xl border border-border p-3 ${comment.hidden ? "opacity-60" : ""}`}>
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
				<div className="min-w-0 text-sm">
					<span className="min-w-0 [overflow-wrap:anywhere] font-medium">{comment.authorName}</span>
					{comment.anonymous && canModerate ? <span className="ml-2 text-xs text-muted-foreground">(anonymous)</span> : null}
					{comment.hidden ? <span className="ml-2 text-xs text-destructive">hidden</span> : null}
					<span className="ml-2 text-xs text-muted-foreground">{WHEN.format(comment.createdAt)}</span>
				</div>
				{canModerate ? <HideCommentButton commentId={comment.id} itemId={itemId} hidden={comment.hidden} /> : null}
			</div>
			<p className="mt-1 min-w-0 whitespace-pre-line text-sm text-foreground/90 [overflow-wrap:anywhere]">{comment.body}</p>
		</div>
	);
}
