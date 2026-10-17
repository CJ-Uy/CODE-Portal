"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { LibrarySearchInput } from "@/db/repositories/library";
import { dropStaleFacets, facetsFor, SORT_LABELS, SORTS, toLibrarySearchParams } from "@/lib/library/search-params";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import { ENGAGEMENT_TYPES, FORMAT_DETAILS, KIND_LABELS, LIBRARY_KINDS, SOURCE_LABELS } from "@/lib/library/taxonomy";
import type { LibrarySource } from "@/lib/library/taxonomy";
import { cn } from "@/lib/utils";

export type FilterTag = { id: string; name: string; groupName: string };

const SOURCES = Object.keys(SOURCE_LABELS) as LibrarySource[];

/** Every change is a navigation: the URL is the only state, so a filtered search can be shared and the back button works. */
function useNavigate(value: ParsedLibrarySearch) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	function change(patch: Partial<LibrarySearchInput>) {
		const next = dropStaleFacets({ ...value, ...patch, offset: 0 });
		const query = toLibrarySearchParams(next).toString();
		startTransition(() => router.push(query ? `/portal/library?${query}` : "/portal/library"));
	}
	return { change, pending };
}

const toggle = <T extends string>(list: readonly T[] | undefined, item: T): T[] | undefined => {
	const next = list?.includes(item) ? list.filter((entry) => entry !== item) : [...(list ?? []), item];
	return next.length ? next : undefined;
};

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

function FilterFields({ value, tags, change }: { value: ParsedLibrarySearch; tags: FilterTag[]; change: (patch: Partial<LibrarySearchInput>) => void }) {
	const facets = facetsFor(value);
	const grouped = new Map<string, FilterTag[]>();
	for (const tag of tags) grouped.set(tag.groupName, [...(grouped.get(tag.groupName) ?? []), tag]);
	const groups = [...grouped];
	const count = activeFilterCount(value);

	return (
		<div className="grid min-w-0 gap-5">
			<Group title="Type">
				{LIBRARY_KINDS.map((kind) => (
					<Chip key={kind} pressed={Boolean(value.kinds?.includes(kind))} onClick={() => change({ kinds: toggle(value.kinds, kind) })}>
						{KIND_LABELS[kind]}
					</Chip>
				))}
			</Group>

			{facets.showSubtype || facets.showModuleFacets ? (
				<div className="grid min-w-0 gap-3">
					{facets.showSubtype ? <FacetSelect label="Kind of document" value={value.subtype} options={facets.subtypes} onChange={(subtype) => change({ subtype })} /> : null}
					{facets.showModuleFacets ? (
						<>
							<FacetSelect label="Module format" value={value.formatDetail} options={FORMAT_DETAILS} onChange={(formatDetail) => change({ formatDetail })} />
							<FacetSelect label="Engagement" value={value.engagementType} options={ENGAGEMENT_TYPES} onChange={(engagementType) => change({ engagementType })} />
						</>
					) : null}
				</div>
			) : null}

			<Group title="Source">
				{SOURCES.map((source) => (
					<Chip key={source} pressed={Boolean(value.sources?.includes(source))} onClick={() => change({ sources: toggle(value.sources, source) })}>
						{SOURCE_LABELS[source]}
					</Chip>
				))}
			</Group>

			{groups.length > 0 ? (
				<div className="grid min-w-0 gap-1">
					<p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Tags</p>
					{groups.map(([groupName, groupTags]) => (
						<details key={groupName} open={groupTags.some((tag) => value.tagIds?.includes(tag.id))} className="group min-w-0 border-t border-border py-1">
							<summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
								<span className="min-w-0 break-all">{groupName}</span>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
							</summary>
							<div className="flex min-w-0 flex-wrap gap-1.5 pb-2 pt-1">
								{groupTags.map((tag) => (
									<Chip key={tag.id} pressed={Boolean(value.tagIds?.includes(tag.id))} onClick={() => change({ tagIds: toggle(value.tagIds, tag.id) })}>
										{tag.name}
									</Chip>
								))}
							</div>
						</details>
					))}
				</div>
			) : null}

			{count > 0 ? (
				<Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => change({ kinds: undefined, sources: undefined, tagIds: undefined, subtype: undefined, formatDetail: undefined, engagementType: undefined })}>
					Clear filters
				</Button>
			) : null}
		</div>
	);
}

/** The search box. A search keeps the filters and starts again from the first page. */
export function SearchBar({ value }: { value: ParsedLibrarySearch }) {
	const { change, pending } = useNavigate(value);
	return (
		<form
			role="search"
			action="/portal/library"
			className="flex min-w-0 items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const q = new FormData(event.currentTarget).get("q");
				change({ q: typeof q === "string" && q.trim() ? q.trim() : undefined });
			}}
		>
			<div className="relative min-w-0 flex-1">
				<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
				{/* key: a navigation that changes q (a clear, or the back button) replaces what is typed. */}
				<Input key={value.q ?? ""} name="q" type="search" defaultValue={value.q ?? ""} maxLength={200} placeholder="Search the library" aria-label="Search the library" className="h-11 pl-9" />
			</div>
			<Button type="submit" variant="secondary" className="h-11" disabled={pending}>
				Search
			</Button>
		</form>
	);
}

/** Filters: a panel beside the results on a wide screen, a sheet behind one button on a phone. */
export function FilterPanel({ value, tags, total }: { value: ParsedLibrarySearch; tags: FilterTag[]; total: number | null }) {
	const { change, pending } = useNavigate(value);
	const count = activeFilterCount(value);

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
							{count > 0 ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{count}</span> : null}
						</Button>
					</SheetTrigger>
					<SheetContent side="right" className="w-[88%] max-w-sm gap-0">
						<SheetHeader className="border-b border-border pr-14">
							<SheetTitle>Filters</SheetTitle>
							<SheetDescription className="sr-only">Narrow the library by type, source and tag.</SheetDescription>
						</SheetHeader>
						<div className={cn("min-h-0 flex-1 overflow-y-auto p-4", pending && "opacity-60")}>
							<FilterFields value={value} tags={tags} change={change} />
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
				<FilterFields value={value} tags={tags} change={change} />
			</div>
		</>
	);
}

export function SortSelect({ value }: { value: ParsedLibrarySearch }) {
	const { change, pending } = useNavigate(value);
	// Relevance only means something while there is a query to rank against.
	const options = SORTS.filter((sort) => sort !== "relevance" || value.q);
	const current = value.sort ?? (value.q ? "relevance" : "newest");
	return (
		<label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
			Sort by
			<Select value={current} disabled={pending} onChange={(event) => change({ sort: event.target.value as (typeof SORTS)[number] })} className="h-10 w-auto text-foreground">
				{options.map((sort) => (
					<option key={sort} value={sort}>
						{SORT_LABELS[sort]}
					</option>
				))}
			</Select>
		</label>
	);
}
