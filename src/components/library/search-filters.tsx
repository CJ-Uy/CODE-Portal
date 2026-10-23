"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { setSmartSearchAction } from "@/app/portal/library/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LibrarySearchInput } from "@/db/repositories/library";
import { applySearchChange, effectiveSort, facetsFor, hasActiveSearch, SORT_LABELS, SORTS, toggleValue, toLibrarySearchParams } from "@/lib/library/search-params";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import { ENGAGEMENT_TYPES, FORMAT_DETAILS, KIND_LABELS, LIBRARY_KINDS, LIBRARY_SOURCES, SOURCE_LABELS } from "@/lib/library/taxonomy";
import type { LibraryKind } from "@/lib/library/taxonomy";
import { cn } from "@/lib/utils";

export type FilterTag = { id: string; name: string; groupName: string };

type Patch = Partial<ParsedLibrarySearch> | ((now: ParsedLibrarySearch) => Partial<ParsedLibrarySearch>);
type Change = (patch: Patch, how?: "replace" | "push") => void;
type SearchState = { query: ParsedLibrarySearch; pending: boolean; change: Change };

const SearchContext = createContext<SearchState | null>(null);

function useSearch(): SearchState {
	const state = useContext(SearchContext);
	if (!state) throw new Error("The library search controls must sit inside a SearchProvider.");
	return state;
}

/**
 * Holds the search the member is building. Every tap is applied to this at once and the URL follows, so a second tap made
 * before the first navigation returns is built on top of the first (the server's copy of the search is always one step behind).
 * A submitted search pushes a history entry, and so does the first filter or sort tap from the bare home; taps after that
 * refine the same results and replace the entry.
 */
export function SearchProvider({ value, children }: { value: ParsedLibrarySearch; children: React.ReactNode }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	// Shows the latest tap until the navigation lands, then falls back to what the server sent.
	const [query, setQuery] = useOptimistic(value, (_current: ParsedLibrarySearch, next: ParsedLibrarySearch) => next);
	// What the next tap builds on. State alone is not enough: two taps in one tick both see the render before them.
	const latest = useRef(value);
	useEffect(() => {
		latest.current = query;
	}, [query]);

	const change: Change = (patch, how) => {
		// The first tap from the bare home pushes, so Back returns to the home; later taps refine the same results and replace.
		const mode = how ?? (hasActiveSearch(latest.current) ? "replace" : "push");
		const next = applySearchChange(latest.current, typeof patch === "function" ? patch(latest.current) : patch);
		latest.current = next;
		const params = toLibrarySearchParams(next).toString();
		const href = params ? `/portal/library?${params}` : "/portal/library";
		startTransition(() => {
			setQuery(next);
			if (mode === "push") router.push(href);
			else router.replace(href, { scroll: false });
		});
	};

	return <SearchContext.Provider value={{ query, pending, change }}>{children}</SearchContext.Provider>;
}

/** True while a search, filter or sort change is on its way, so the list can dim instead of showing stale rows as current. */
export function useSearchPending(): boolean {
	return useSearch().pending;
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"min-h-10 min-w-0 max-w-full shrink-0 [overflow-wrap:anywhere] rounded-full border px-3 py-1 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				pressed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-accent hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<fieldset className="grid min-w-0 gap-2">
			<legend className="mb-1 text-sm font-medium">{title}</legend>
			<div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
		</fieldset>
	);
}

function FacetSelect({ label, value, options, onChange }: { label: string; value: string | undefined; options: readonly string[]; onChange: (value: string | undefined) => void }) {
	return (
		<label className="grid min-w-0 gap-1 text-sm font-medium">
			{label}
			<Select value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} className="font-normal">
				<option value="">Any</option>
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</Select>
		</label>
	);
}

/** Filters that live behind More filters (everything but the type chips), so the button can say how many are on. */
function hiddenFilterCount(value: LibrarySearchInput): number {
	return (value.sources?.length ?? 0) + (value.tagIds?.length ?? 0) + [value.subtype, value.formatDetail, value.engagementType].filter(Boolean).length;
}

/**
 * The member's remembered choice. Flipping it saves the preference and drops any ?smart= override, so what the switch
 * shows is what the next search does.
 */
function SmartSearchSwitch({ on }: { on: boolean }) {
	const { change } = useSearch();
	const id = useId();
	const [checked, setChecked] = useOptimistic(on);
	const [failed, setFailed] = useState(false);
	const [pending, startTransition] = useTransition();
	const flip = (next: boolean) =>
		startTransition(async () => {
			setChecked(next);
			setFailed(false);
			try {
				await setSmartSearchAction(next);
				change({ smart: null });
			} catch {
				setFailed(true);
			}
		});

	return (
		<div className="flex min-w-0 items-start justify-between gap-3 border-b border-border pb-4">
			<div className="grid min-w-0 gap-0.5">
				<p id={`${id}-label`} className="text-sm font-medium">
					Smart search
				</p>
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					Suggests keywords and finds items by meaning, not only by matching words.
				</p>
				{failed ? (
					<p role="alert" className="text-xs text-destructive">
						Could not save that. Try again.
					</p>
				) : null}
			</div>
			<Switch checked={checked} disabled={pending} onChange={flip} labelledBy={`${id}-label`} describedBy={`${id}-hint`} />
		</div>
	);
}

/** Everything behind More filters. Type stays out in the open as chips; these are the finer cuts. */
function MoreFilterFields({ tags, smart }: { tags: FilterTag[]; smart: boolean | null }) {
	const { query, change } = useSearch();
	const facets = facetsFor(query);
	const grouped = new Map<string, FilterTag[]>();
	for (const tag of tags) grouped.set(tag.groupName, [...(grouped.get(tag.groupName) ?? []), tag]);
	const groups = [...grouped];

	return (
		<div className="grid min-w-0 gap-5">
			{smart !== null ? <SmartSearchSwitch on={smart} /> : null}

			{facets.showSubtype || facets.showModuleFacets ? (
				<div className="grid min-w-0 gap-3 sm:grid-cols-3">
					{facets.showSubtype ? <FacetSelect label="Kind of document" value={query.subtype} options={facets.subtypes} onChange={(subtype) => change({ subtype })} /> : null}
					{facets.showModuleFacets ? (
						<>
							<FacetSelect label="Module format" value={query.formatDetail} options={FORMAT_DETAILS} onChange={(formatDetail) => change({ formatDetail })} />
							<FacetSelect label="Engagement" value={query.engagementType} options={ENGAGEMENT_TYPES} onChange={(engagementType) => change({ engagementType })} />
						</>
					) : null}
				</div>
			) : null}

			<Group title="Source">
				{LIBRARY_SOURCES.map((source) => (
					<Chip key={source} pressed={Boolean(query.sources?.includes(source))} onClick={() => change((now) => ({ sources: toggleValue(now.sources, source) }))}>
						{SOURCE_LABELS[source]}
					</Chip>
				))}
			</Group>

			{groups.length > 0 ? (
				<div className="grid min-w-0 gap-1">
					<p className="mb-1 text-sm font-medium">Tags</p>
					<div className="grid min-w-0 gap-x-6 sm:grid-cols-2">
						{groups.map(([groupName, groupTags]) => (
							<details key={groupName} open={groupTags.some((tag) => query.tagIds?.includes(tag.id))} className="group min-w-0 border-t border-border py-1">
								<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
									<span className="min-w-0 [overflow-wrap:anywhere]">{groupName}</span>
									<ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
								</summary>
								<div className="flex min-w-0 flex-wrap gap-1.5 pb-2 pt-1">
									{groupTags.map((tag) => (
										<Chip key={tag.id} pressed={Boolean(query.tagIds?.includes(tag.id))} onClick={() => change((now) => ({ tagIds: toggleValue(now.tagIds, tag.id) }))}>
											{tag.name}
										</Chip>
									))}
								</div>
							</details>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

/** One applied filter that is not a type chip, with its own way off. The label is user-controlled (a tag), so it wraps anywhere. */
function AppliedFilter({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<li className="min-w-0">
			<button
				type="button"
				onClick={onRemove}
				className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-secondary px-3 text-sm text-secondary-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
				<X className="size-3.5 shrink-0" aria-hidden />
				<span className="sr-only">, remove this filter</span>
			</button>
		</li>
	);
}

/**
 * The filters: type chips out in the open (one row that scrolls sideways on a phone), the rest behind More filters, and
 * every hidden filter that is on listed underneath with a way to take it off, so nothing narrows the list out of sight.
 * `kinds` are the types with something to find (all of them when unknown); one already in the URL always shows, so it can be cleared.
 * `smart` is whether smart search is on for this member, or null when it is not available at all (then there is no switch).
 */
export function FilterBar({ tags, kinds = LIBRARY_KINDS, smart = null }: { tags: FilterTag[]; kinds?: readonly LibraryKind[]; smart?: boolean | null }) {
	const { query, pending, change } = useSearch();
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const hidden = hiddenFilterCount(query);
	const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
	const applied: { key: string; label: string; off: Patch }[] = [
		...(query.sources ?? []).map((source) => ({ key: `source-${source}`, label: SOURCE_LABELS[source], off: (now: ParsedLibrarySearch) => ({ sources: toggleValue(now.sources, source) }) })),
		...(query.subtype ? [{ key: "subtype", label: query.subtype, off: { subtype: undefined } }] : []),
		...(query.formatDetail ? [{ key: "format", label: `Format: ${query.formatDetail}`, off: { formatDetail: undefined } }] : []),
		...(query.engagementType ? [{ key: "engagement", label: `Engagement: ${query.engagementType}`, off: { engagementType: undefined } }] : []),
		...(query.tagIds ?? []).map((id) => ({ key: `tag-${id}`, label: tagName.get(id) ?? "Tag", off: (now: ParsedLibrarySearch) => ({ tagIds: toggleValue(now.tagIds, id) }) })),
	];

	return (
		<div className="grid min-w-0 gap-3">
			<div className="flex min-w-0 items-start gap-2">
				{/* On a phone the chips scroll sideways; the fade at the right edge says there are more. */}
				<div
					role="group"
					aria-label="Type"
					className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:[mask-image:none]"
				>
					<Chip pressed={!query.kinds?.length} onClick={() => query.kinds?.length && change({ kinds: undefined })}>
						All types
					</Chip>
					{LIBRARY_KINDS.filter((kind) => kinds.includes(kind) || query.kinds?.includes(kind)).map((kind) => (
						<Chip key={kind} pressed={Boolean(query.kinds?.includes(kind))} onClick={() => change((now) => ({ kinds: toggleValue(now.kinds, kind) }))}>
							{KIND_LABELS[kind]}
						</Chip>
					))}
				</div>
				<Button type="button" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="min-h-10 shrink-0">
					<SlidersHorizontal aria-hidden />
					<span className="hidden sm:inline">More filters</span>
					<span className="sm:hidden">Filters</span>
					{hidden > 0 ? (
						<span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
							<span aria-hidden>{hidden}</span>
							<span className="sr-only">, {hidden} on</span>
						</span>
					) : null}
					<ChevronDown className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
				</Button>
			</div>

			{open ? (
				<div id={panelId} className={cn("min-w-0 rounded-xl border border-border bg-card p-4 transition-opacity", pending && "opacity-60")}>
					<MoreFilterFields tags={tags} smart={smart} />
				</div>
			) : null}

			{applied.length > 0 || hasActiveSearch(query) ? (
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					{applied.length > 0 ? (
						<ul aria-label="Filters on" className="flex min-w-0 flex-wrap gap-1.5">
							{applied.map((filter) => (
								<AppliedFilter key={filter.key} label={filter.label} onRemove={() => change(filter.off)} />
							))}
						</ul>
					) : null}
					<Button
						type="button"
						variant="ghost"
						className="min-h-9 px-2 text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline"
						onClick={() =>
							change(
								{ q: undefined, kinds: undefined, sources: undefined, tagIds: undefined, subtype: undefined, formatDetail: undefined, engagementType: undefined, without: undefined },
								"push",
							)
						}
					>
						Clear search and filters
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** The search box. A search keeps the filters and starts again from the first page. */
export function SearchBar() {
	const { query, pending, change } = useSearch();
	return (
		<form
			role="search"
			action="/portal/library"
			className="flex min-w-0 items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const q = new FormData(event.currentTarget).get("q");
				// A new search gets new chips, so the ones removed from the last search come back into play.
				change({ q: typeof q === "string" && q.trim() ? q.trim() : undefined, without: undefined }, "push");
			}}
		>
			<div className="relative min-w-0 flex-1">
				<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
				{/* key: a navigation that changes q (a clear, or the back button) replaces what is typed. */}
				<Input key={query.q ?? ""} name="q" type="search" enterKeyHint="search" defaultValue={query.q ?? ""} maxLength={200} placeholder="Search by title, topic, author or tag" aria-label="Search the library" className="h-11 pl-9" />
			</div>
			<Button type="submit" variant="secondary" className="h-11" disabled={pending}>
				Search
			</Button>
		</form>
	);
}

export function SortSelect() {
	const { query, change } = useSearch();
	// Relevance only means something while there is a query to rank against, and the select shows the sort the results really use.
	const options = SORTS.filter((sort) => sort !== "relevance" || query.q);
	return (
		<label className="flex min-w-0 shrink-0 items-center gap-2 text-sm text-muted-foreground">
			Sort
			{/* A new order of the same list, so it replaces the history entry instead of adding one. */}
			<Select value={effectiveSort(query)} onChange={(event) => change({ sort: event.target.value as (typeof SORTS)[number] }, "replace")} className="h-10 w-auto text-foreground">
				{options.map((sort) => (
					<option key={sort} value={sort}>
						{SORT_LABELS[sort]}
					</option>
				))}
			</Select>
		</label>
	);
}
