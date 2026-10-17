"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useOptimistic, useRef, useTransition } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { LibrarySearchInput } from "@/db/repositories/library";
import { applySearchChange, effectiveSort, facetsFor, SORT_LABELS, SORTS, toggleValue, toLibrarySearchParams } from "@/lib/library/search-params";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import { ENGAGEMENT_TYPES, FORMAT_DETAILS, KIND_LABELS, LIBRARY_KINDS, LIBRARY_SOURCES, SOURCE_LABELS } from "@/lib/library/taxonomy";
import { cn } from "@/lib/utils";

export type FilterTag = { id: string; name: string; groupName: string };

type Patch = Partial<LibrarySearchInput> | ((now: ParsedLibrarySearch) => Partial<LibrarySearchInput>);
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
 * Filters and sort replace the history entry; a submitted search pushes one.
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

	const change: Change = (patch, how = "replace") => {
		const next = applySearchChange(latest.current, typeof patch === "function" ? patch(latest.current) : patch);
		latest.current = next;
		const params = toLibrarySearchParams(next).toString();
		const href = params ? `/portal/library?${params}` : "/portal/library";
		startTransition(() => {
			setQuery(next);
			if (how === "push") router.push(href);
			else router.replace(href, { scroll: false });
		});
	};

	return <SearchContext.Provider value={{ query, pending, change }}>{children}</SearchContext.Provider>;
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"min-h-10 min-w-0 max-w-full break-all rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8",
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
			<legend className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</legend>
			<div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
		</fieldset>
	);
}

function FacetSelect({ label, value, options, onChange }: { label: string; value: string | undefined; options: readonly string[]; onChange: (value: string | undefined) => void }) {
	return (
		<label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-muted-foreground">
			{label}
			<Select value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} className="font-normal normal-case text-foreground">
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

function activeFilterCount(value: LibrarySearchInput): number {
	return (value.kinds?.length ?? 0) + (value.sources?.length ?? 0) + (value.tagIds?.length ?? 0) + [value.subtype, value.formatDetail, value.engagementType].filter(Boolean).length;
}

function FilterFields({ tags }: { tags: FilterTag[] }) {
	const { query, change } = useSearch();
	const facets = facetsFor(query);
	const grouped = new Map<string, FilterTag[]>();
	for (const tag of tags) grouped.set(tag.groupName, [...(grouped.get(tag.groupName) ?? []), tag]);
	const groups = [...grouped];

	return (
		<div className="grid min-w-0 gap-5">
			<Group title="Type">
				{LIBRARY_KINDS.map((kind) => (
					<Chip key={kind} pressed={Boolean(query.kinds?.includes(kind))} onClick={() => change((now) => ({ kinds: toggleValue(now.kinds, kind) }))}>
						{KIND_LABELS[kind]}
					</Chip>
				))}
			</Group>

			{facets.showSubtype || facets.showModuleFacets ? (
				<div className="grid min-w-0 gap-3">
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
					<p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Tags</p>
					{groups.map(([groupName, groupTags]) => (
						<details key={groupName} open={groupTags.some((tag) => query.tagIds?.includes(tag.id))} className="group min-w-0 border-t border-border py-1">
							<summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
								<span className="min-w-0 break-all">{groupName}</span>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
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
			) : null}

			{activeFilterCount(query) > 0 ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					onClick={() => change({ kinds: undefined, sources: undefined, tagIds: undefined, subtype: undefined, formatDetail: undefined, engagementType: undefined })}
				>
					Clear filters
				</Button>
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
				change({ q: typeof q === "string" && q.trim() ? q.trim() : undefined }, "push");
			}}
		>
			<div className="relative min-w-0 flex-1">
				<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
				{/* key: a navigation that changes q (a clear, or the back button) replaces what is typed. */}
				<Input key={query.q ?? ""} name="q" type="search" defaultValue={query.q ?? ""} maxLength={200} placeholder="Search the library" aria-label="Search the library" className="h-11 pl-9" />
			</div>
			<Button type="submit" variant="secondary" className="h-11" disabled={pending}>
				Search
			</Button>
		</form>
	);
}

/** Filters: a panel beside the results on a wide screen, a sheet behind one button on a phone. */
export function FilterPanel({ tags, total }: { tags: FilterTag[]; total: number | null }) {
	const { query, pending } = useSearch();
	const count = activeFilterCount(query);

	return (
		<>
			<div className="lg:hidden">
				<Sheet>
					<SheetTrigger asChild>
						<Button type="button" variant="outline" className="h-11 w-full justify-between">
							<span className="inline-flex items-center gap-2">
								<SlidersHorizontal aria-hidden />
								Filters
							</span>
							{count > 0 ? (
								<span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
									<span aria-hidden>{count}</span>
									<span className="sr-only">
										{count} {count === 1 ? "filter" : "filters"} active
									</span>
								</span>
							) : null}
						</Button>
					</SheetTrigger>
					<SheetContent side="right" className="w-[88%] max-w-sm gap-0">
						<SheetHeader className="border-b border-border pr-14">
							<SheetTitle>Filters</SheetTitle>
							<SheetDescription className="sr-only">Narrow the library by type, source and tag.</SheetDescription>
						</SheetHeader>
						<div className={cn("min-h-0 flex-1 overflow-y-auto p-4", pending && "opacity-60")}>
							<FilterFields tags={tags} />
						</div>
						<SheetFooter className="border-t border-border">
							<SheetClose asChild>
								<Button type="button" className="h-11">
									{total === null ? "Show results" : `Show ${total.toLocaleString("en-US")} ${total === 1 ? "result" : "results"}`}
								</Button>
							</SheetClose>
						</SheetFooter>
					</SheetContent>
				</Sheet>
			</div>
			<div className={cn("hidden min-w-0 rounded-xl border border-border bg-card p-4 lg:block", pending && "opacity-60")}>
				<FilterFields tags={tags} />
			</div>
		</>
	);
}

export function SortSelect() {
	const { query, change } = useSearch();
	// Relevance only means something while there is a query to rank against, and the select shows the sort the results really use.
	const options = SORTS.filter((sort) => sort !== "relevance" || query.q);
	return (
		<label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
			Sort by
			<Select value={effectiveSort(query)} onChange={(event) => change({ sort: event.target.value as (typeof SORTS)[number] })} className="h-10 w-auto text-foreground">
				{options.map((sort) => (
					<option key={sort} value={sort}>
						{SORT_LABELS[sort]}
					</option>
				))}
			</Select>
		</label>
	);
}
