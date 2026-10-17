import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Plus, SearchX } from "lucide-react";
import { getRepositories } from "@/db";
import type { LibraryCard } from "@/db/repositories/library";
import type { LibraryListSummary } from "@/db/repositories/library-lists";
import { LibraryItemCard } from "@/components/library/library-card";
import { PitchBanner } from "@/components/library/pitch-banner";
import { FilterPanel, SearchBar, SearchProvider, SortSelect } from "@/components/library/search-filters";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { formatHours } from "@/lib/library/activity";
import { hasActiveSearch, PAGE_SIZE, pageInfo, parseLibrarySearchParams, toLibrarySearchParams } from "@/lib/library/search-params";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { getLibraryAi } from "@/server/library/ai";
import { searchLibrary, smartSearchPreference } from "@/server/library/smart-search";
import type { SmartChip } from "@/server/library/smart-search";

export const dynamic = "force-dynamic";

const SHELF_SIZE = 6;
const RECENT_SIZE = 8;

const CARD_GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";
const NO_CARDS: { cards: LibraryCard[]; total: number } = { cards: [], total: 0 };

function pageHref(search: ParsedLibrarySearch, page: number): string {
	const query = toLibrarySearchParams({ ...search, offset: (page - 1) * PAGE_SIZE }).toString();
	return query ? `/portal/library?${query}` : "/portal/library";
}

function Cards({ cards }: { cards: LibraryCard[] }) {
	return (
		<ul className={CARD_GRID}>
			{cards.map((card) => (
				<li key={card.id} className="min-w-0">
					<LibraryItemCard card={card} />
				</li>
			))}
		</ul>
	);
}

function Section({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section aria-labelledby={id} className="grid min-w-0 gap-3">
			<div className="flex min-w-0 items-baseline justify-between gap-3">
				<h2 id={id} className="font-heading text-xl">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

function CollectionsShelf({ lists }: { lists: LibraryListSummary[] }) {
	return (
		<ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
			{lists.map((list) => (
				<li key={list.id} className="w-64 shrink-0 snap-start">
					<Link
						href={`/portal/library/lists/${list.id}`}
						className="flex h-full min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="mt-1 size-4 shrink-0 rounded-full" style={{ backgroundColor: list.color }} aria-hidden />
						<div className="grid min-w-0 flex-1 gap-1">
							<p className="min-w-0 break-all font-medium leading-snug">{list.name}</p>
							{list.description.trim() ? <p className="line-clamp-2 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{list.description}</p> : null}
							<p className="text-xs text-muted-foreground">
								{list.itemCount} {list.itemCount === 1 ? "item" : "items"}
							</p>
						</div>
					</Link>
				</li>
			))}
		</ul>
	);
}

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
								href={`/portal/library?${toLibrarySearchParams({ ...search, offset: 0, without })}`}
								aria-label={`Remove ${chip.label}`}
								title="Remove"
								scroll={false}
								className="inline-flex min-h-8 min-w-0 max-w-full items-center break-all rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:border-accent hover:line-through focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

function Results({ search, cards, total }: { search: ParsedLibrarySearch; cards: LibraryCard[]; total: number }) {
	const { page, pages, prev, next } = pageInfo(total, search.offset ?? 0);

	return (
		<section aria-labelledby="library-results" className="grid min-w-0 gap-4">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
				<div className="min-w-0" aria-live="polite">
					<h2 id="library-results" className="font-heading text-xl">
						{total.toLocaleString("en-US")} {total === 1 ? "result" : "results"}
					</h2>
					{search.q ? <p className="min-w-0 break-all text-sm text-muted-foreground">for &ldquo;{search.q}&rdquo;</p> : null}
				</div>
				<SortSelect />
			</div>

			{cards.length > 0 ? (
				<Cards cards={cards} />
			) : (
				<EmptyState
					icon={SearchX}
					title={total > 0 ? "That page is past the end" : "Nothing matches"}
					description={total > 0 ? undefined : "Try fewer words, or take a filter off."}
					action={
						<Button asChild variant="secondary" size="sm">
							<Link href={total > 0 ? pageHref(search, 1) : search.q ? `/portal/library?${toLibrarySearchParams({ q: search.q })}` : "/portal/library"}>
								{total > 0 ? "Back to the first page" : "Clear filters"}
							</Link>
						</Button>
					}
				/>
			)}

			{pages > 1 ? (
				<nav aria-label="Pages" className="flex items-center justify-between gap-3">
					{prev !== null ? (
						<Button asChild variant="outline" size="sm" className="min-h-10">
							<Link href={pageHref(search, prev)} rel="prev">
								<ChevronLeft aria-hidden />
								Previous
							</Link>
						</Button>
					) : (
						<span />
					)}
					<span className="text-sm text-muted-foreground">
						Page {page} of {pages}
					</span>
					{next !== null ? (
						<Button asChild variant="outline" size="sm" className="min-h-10">
							<Link href={pageHref(search, next)} rel="next">
								Next
								<ChevronRight aria-hidden />
							</Link>
						</Button>
					) : (
						<span />
					)}
				</nav>
			) : null}
		</section>
	);
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is what a signed-in member hits.
	// Kept above the data loading so a disabled surface never touches a repository.
	if (!isFeatureEnabled("library")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	const search = parseLibrarySearchParams(await searchParams);
	const searching = hasActiveSearch(search);

	const repositories = await getRepositories();
	const { library, libraryTags, libraryLists, libraryActivity } = repositories;
	// Null when the flag is off or the bindings are missing: then no switch, no chips, and plain search.
	const smart = getLibraryAi();
	const preference = smart ? await smartSearchPreference(repositories.members, actor) : false;
	// Each read falls back to empty, like the dashboard, so one repository being unavailable never takes the whole page down.
	const tags = libraryTags.listTags().catch(() => []);
	const results = searching ? await searchLibrary(actor, search, { smart, preference, repos: repositories }).catch(() => ({ ...NO_CARDS, chips: [] })) : null;
	const home = searching
		? null
		: await Promise.all([
				libraryLists.collections(actor).catch((): LibraryListSummary[] => []),
				// "This term" is the term row that covers today; termStart falls back to the last 120 days when none does.
				libraryActivity
					.termStart()
					.then((since) => libraryActivity.mostSavedSince(actor, since, SHELF_SIZE))
					.catch((): LibraryCard[] => []),
				libraryActivity.totalActiveSeconds().catch(() => 0),
				library.search(actor, { sort: "newest", limit: RECENT_SIZE }).catch(() => NO_CARDS),
			]);
	// Only tags that have something to find, plus any already in the URL so a shared link can still be cleared.
	const filterTags = (await tags)
		.filter((tag) => tag.itemCount > 0 || search.tagIds?.includes(tag.id))
		.map(({ id, name, groupName }) => ({ id, name, groupName }));

	return (
		<div className="mx-auto grid min-w-0 max-w-6xl gap-6">
			<div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
					<h1 className="font-heading text-3xl">Library</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Past modules, frameworks and guides, written by CODErs and found in one place. Search before you write your next one.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button asChild size="sm" className="min-h-10">
						<Link href="/portal/library/new">
							<Plus aria-hidden />
							Add to library
						</Link>
					</Button>
					<Button asChild variant="ghost" size="sm" className="min-h-10">
						<Link href="/portal/library/mine">My items</Link>
					</Button>
					<Button asChild variant="ghost" size="sm" className="min-h-10">
						<Link href="/portal/library/lists">My lists</Link>
					</Button>
				</div>
			</div>

			<PitchBanner />

			<SearchProvider value={search}>
				<div className="grid min-w-0 gap-2">
					<SearchBar />
					{results?.chips.length ? <KeywordChips search={search} chips={results.chips} /> : null}
				</div>

				<div className="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
					<aside aria-label="Filters" className="min-w-0">
						<FilterPanel tags={filterTags} total={results?.total ?? null} smart={smart ? (search.smart ?? preference) : null} />
					</aside>

					<div className="grid min-w-0 gap-8">
						{results ? (
							<Results search={search} cards={results.cards} total={results.total} />
						) : home ? (
							<>
								{home[0].length > 0 ? (
									<Section id="library-collections" title="Collections">
										<CollectionsShelf lists={home[0]} />
									</Section>
								) : null}
								{home[1].length > 0 ? (
									<Section id="library-most-saved" title="Most saved this term">
										<Cards cards={home[1]} />
									</Section>
								) : null}
								<p className="min-w-0 rounded-xl border border-border bg-secondary/50 px-4 py-3 font-heading text-lg">{`${formatHours(home[2])} of reading so far`}</p>
								<Section
									id="library-recent"
									title="Recently added"
									action={
										<Link href="/portal/library?sort=newest" className="shrink-0 text-sm text-accent hover:underline">
											See everything
										</Link>
									}
								>
									{home[3].cards.length > 0 ? (
										<Cards cards={home[3].cards} />
									) : (
										<EmptyState
											icon={BookOpen}
											title="Nothing here yet"
											description="The first thing added will show up here."
											action={
												<Button asChild variant="secondary" size="sm">
													<Link href="/portal/library/new">Add to library</Link>
												</Button>
											}
										/>
									)}
								</Section>
							</>
						) : null}
					</div>
				</div>
			</SearchProvider>
		</div>
	);
}
