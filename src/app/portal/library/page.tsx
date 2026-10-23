import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { BookOpen, History, SearchX } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryCard } from "@/db/repositories/library";
import type { LibraryListSummary } from "@/db/repositories/library-lists";
import { LibraryItemCard } from "@/components/library/library-card";
import { LibraryFeed } from "@/components/library/library-feed";
import { LibraryHeader } from "@/components/library/library-header";
import { FilterBar, SearchBar, SearchProvider, SortSelect } from "@/components/library/search-filters";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { toCardFields } from "@/lib/library/card-fields";
import { listHref } from "@/lib/library/list-memory";
import { effectiveSort, hasActiveSearch, parseLibrarySearchParams, toLibrarySearchParams } from "@/lib/library/search-params";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import { KIND_LABELS, LIBRARY_KINDS } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { getLibraryAi } from "@/server/library/ai";
import { searchLibrary, smartSearchPreference } from "@/server/library/smart-search";
import type { SmartChip } from "@/server/library/smart-search";

export const dynamic = "force-dynamic";

const LATEST_SIZE = 4;
const PERSONAL_SIZE = 4;
const count = (n: number) => n.toLocaleString("en-US");

/** Smart search's keywords: plain pills, each a link to the same search without it. */
function KeywordChips({ search, chips }: { search: ParsedLibrarySearch; chips: SmartChip[] }) {
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			<span className="text-xs text-muted-foreground">Also searching for</span>
			<ul className="contents">
				{chips.map((chip) => {
					const without = [...(search.without ?? []), chip.label.toLowerCase()];
					return (
						<li key={chip.label} className="min-w-0">
							<Link
								href={listHref(toLibrarySearchParams({ ...search, without }).toString())}
								aria-label={`Remove ${chip.label}`}
								title="Remove"
								scroll={false}
								className="inline-flex min-h-8 min-w-0 max-w-full items-center [overflow-wrap:anywhere] rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-accent hover:line-through focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{chip.label}
							</Link>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** A short row of plain links above the list: where a member left off, or, before they have opened anything, where to start. */
function QuickLinks({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section aria-labelledby={id} className="grid min-w-0 gap-1">
			<div className="flex min-w-0 items-baseline justify-between gap-3">
				<h2 id={id} className="font-sans text-sm font-medium text-muted-foreground">
					{title}
				</h2>
				{action}
			</div>
			<ul className="grid min-w-0 gap-x-8 sm:grid-cols-2">{children}</ul>
		</section>
	);
}

const QUICK_LINK = "flex min-h-11 min-w-0 items-center gap-2 rounded-md text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function RecentlyOpened({ cards }: { cards: LibraryCard[] }) {
	return (
		<QuickLinks id="library-recent" title="Recently opened">
			{cards.map((card) => (
				// Two on a phone, so the list itself starts higher up the screen.
				<li key={card.id} className="min-w-0 max-sm:nth-[n+3]:hidden">
					<Link href={`/portal/library/${card.id}`} className={QUICK_LINK}>
						<History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
						<span className="min-w-0 truncate font-medium">{card.title}</span>
						<span className="shrink-0 text-xs text-muted-foreground">{KIND_LABELS[card.kind]}</span>
					</Link>
				</li>
			))}
		</QuickLinks>
	);
}

/** Moderators' pinned collections, shown only until the member has opened something; then Recently opened takes the spot. */
function StartWithCollection({ lists }: { lists: LibraryListSummary[] }) {
	return (
		<QuickLinks
			id="library-start"
			title="New here? Start with a collection"
			action={
				<Link href="/portal/library/lists" className="shrink-0 text-sm text-accent hover:underline">
					All lists
				</Link>
			}
		>
			{lists.slice(0, PERSONAL_SIZE).map((list) => (
				<li key={list.id} className="min-w-0 max-sm:nth-[n+3]:hidden">
					<Link href={`/portal/library/lists/${list.id}`} className={QUICK_LINK}>
						<span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: list.color }} aria-hidden />
						<span className="min-w-0 truncate font-medium">{list.name}</span>
						<span className="shrink-0 text-xs text-muted-foreground">
							{list.itemCount} {list.itemCount === 1 ? "item" : "items"}
						</span>
					</Link>
				</li>
			))}
		</QuickLinks>
	);
}

function Latest({ cards }: { cards: LibraryCard[] }) {
	return (
		<section aria-labelledby="library-latest" className="grid min-w-0 gap-3">
			<div className="flex min-w-0 items-baseline justify-between gap-3">
				<h2 id="library-latest" className="font-heading text-xl">
					Latest
				</h2>
				<Link href="/portal/library?sort=newest#library-list" className="shrink-0 text-sm text-accent hover:underline">
					All items, newest first
				</Link>
			</div>
			{/* A phone gets one swipeable row; wider screens see all four at once. */}
			<ul className="-mx-4 flex min-w-0 snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
				{cards.map((card) => (
					<li key={card.id} className="w-64 shrink-0 snap-start sm:w-auto">
						<LibraryItemCard card={toCardFields(card)} compact />
					</li>
				))}
			</ul>
		</section>
	);
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is what a signed-in member hits.
	// Kept above the data loading so a disabled surface never touches a repository.
	if (!isFeatureEnabled("library")) notFound();

	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	const search = parseLibrarySearchParams(await searchParams);
	const searching = hasActiveSearch(search);
	// The list's identity: the URL's own search. The load-more action reads the same string, so every page of it agrees.
	const listKey = toLibrarySearchParams(search).toString();

	const repositories = await getRepositories();
	const { library, libraryTags, libraryLists, libraryActivity } = repositories;
	// Null when the flag is off or the bindings are missing: then no switch, no chips, and plain search.
	const smart = getLibraryAi();
	const preference = smart ? await smartSearchPreference(repositories.members, actor) : false;
	// Each read falls back to empty, like the dashboard, so one repository being unavailable never takes the whole page down.
	const [tags, kindCounts, results, home] = await Promise.all([
		libraryTags.listTags().catch(() => []),
		library.kindCounts(actor).catch(() => null),
		searchLibrary(actor, { ...search, sort: effectiveSort(search) }, { smart, preference, repos: repositories }).catch(() => ({
			cards: [] as LibraryCard[],
			total: 0,
			nextCursor: null,
			chips: [] as SmartChip[],
		})),
		searching
			? null
			: Promise.all([
					libraryActivity.recentlyOpened(actor, PERSONAL_SIZE).catch((): LibraryCard[] => []),
					libraryLists.collections(actor).catch((): LibraryListSummary[] => []),
					library
						.search(actor, { sort: "newest", limit: LATEST_SIZE })
						.then((page) => page.cards)
						.catch((): LibraryCard[] => []),
				]),
	]);
	const announcement = searching ? `${count(results.total)} ${results.total === 1 ? "result" : "results"}${search.q ? ` for ${search.q}` : ""}` : "";
	// Only tags that have something to find, plus any already in the URL so a shared link can still be cleared.
	const filterTags = tags.filter((tag) => tag.itemCount > 0 || search.tagIds?.includes(tag.id)).map(({ id, name, groupName }) => ({ id, name, groupName }));

	return (
		<div className="mx-auto grid min-w-0 max-w-6xl gap-8">
			<LibraryHeader current="browse" />

			<SearchProvider value={search}>
				{/* One live region that stays mounted across the home and a search, so the first search is announced too. */}
				<p aria-live="polite" aria-atomic="true" className="sr-only">
					{announcement}
				</p>
				<div className="grid min-w-0 gap-3">
					<SearchBar />
					{results.chips.length ? <KeywordChips search={search} chips={results.chips} /> : null}
					<FilterBar tags={filterTags} kinds={kindCounts ? LIBRARY_KINDS.filter((kind) => kindCounts[kind]) : undefined} smart={smart ? (search.smart ?? preference) : null} />
				</div>

				{home ? (
					<>
						{home[0].length > 0 ? <RecentlyOpened cards={home[0]} /> : home[1].length > 0 ? <StartWithCollection lists={home[1]} /> : null}
						{home[2].length > 0 ? <Latest cards={home[2]} /> : null}
					</>
				) : null}

				<section aria-labelledby="library-list" className="grid min-w-0 scroll-mt-24 gap-3">
					<div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
						<div className="min-w-0">
							<h2 id="library-list" className="font-heading text-xl">
								{searching ? `${count(results.total)} ${results.total === 1 ? "result" : "results"}` : "All items"}
							</h2>
							<p className="min-w-0 [overflow-wrap:anywhere] text-sm text-muted-foreground">
								{searching ? (search.q ? `for "${search.q}"` : "with the filters above") : `${count(results.total)} ${results.total === 1 ? "item" : "items"} in the library`}
							</p>
						</div>
						{results.total > 0 ? <SortSelect /> : null}
					</div>

					{results.total > 0 ? (
						<LibraryFeed key={listKey} listKey={listKey} cards={results.cards.map(toCardFields)} nextCursor={results.nextCursor} total={results.total} />
					) : searching ? (
						<EmptyState
							icon={SearchX}
							title="Nothing matches"
							description="Try fewer or different words, or take a filter off. Smart search, under More filters, also finds items by meaning."
							action={
								<Button asChild variant="secondary">
									<Link href="/portal/library">Clear search and filters</Link>
								</Button>
							}
						/>
					) : (
						<EmptyState
							icon={BookOpen}
							title="The library is empty"
							description="The first thing added will show up here."
							action={
								<Button asChild>
									<Link href="/portal/library/new">Add to the library</Link>
								</Button>
							}
						/>
					)}
				</section>
			</SearchProvider>
		</div>
	);
}
