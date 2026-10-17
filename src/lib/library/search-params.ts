import type { LibrarySearchInput } from "@/db/repositories/library";
import { ENGAGEMENT_TYPES, FORMAT_DETAILS, LIBRARY_KINDS, LIBRARY_SOURCES, SUBTYPES } from "./taxonomy";

/** The library search page and its URL: one place that decides which query values are believed. */
export const PAGE_SIZE = 24;

export const SORTS = ["relevance", "newest", "most_saved", "most_read"] as const;
export const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
	relevance: "Relevance",
	newest: "Newest",
	most_saved: "Most saved",
	most_read: "Most read",
};
const SUBTYPE_VALUES: readonly string[] = [...SUBTYPES.code_document, ...SUBTYPES.reading];

const Q_MAX = 200;
const TAG_ID = /^ltg_[A-Za-z0-9_-]{1,60}$/;
const TAGS_MAX = 20;
const PAGE_MAX = 10_000;

type RawParams = Record<string, string | string[] | undefined>;
export type ParsedLibrarySearch = LibrarySearchInput & { smart: boolean | null };

const many = (value: string | string[] | undefined): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function oneOf<T extends string>(values: string[], allowed: readonly T[]): T[] | undefined {
	const kept = [...new Set(values)].filter((value): value is T => (allowed as readonly string[]).includes(value));
	return kept.length ? kept : undefined;
}

/** Everything in the URL is untrusted: unknown values are dropped, never passed through to the search. */
export function parseLibrarySearchParams(params: RawParams): ParsedLibrarySearch {
	const q = Array.from(many(params.q)[0]?.trim() ?? "").slice(0, Q_MAX).join("").trim();
	const kinds = oneOf(many(params.type), LIBRARY_KINDS);
	const sources = oneOf(many(params.source), LIBRARY_SOURCES);
	const tagIds = [...new Set(many(params.tag).filter((id) => TAG_ID.test(id)))].slice(0, TAGS_MAX);
	const subtype = oneOf(many(params.subtype).slice(0, 1), SUBTYPE_VALUES)?.[0];
	const formatDetail = oneOf(many(params.format).slice(0, 1), FORMAT_DETAILS)?.[0];
	const engagementType = oneOf(many(params.engagement).slice(0, 1), ENGAGEMENT_TYPES)?.[0];
	const sort = oneOf(many(params.sort).slice(0, 1), SORTS)?.[0];
	const rawPage = many(params.page)[0] ?? "";
	const page = /^\d{1,5}$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= PAGE_MAX ? Number(rawPage) : 1;
	const smart = many(params.smart)[0];

	return {
		...(q ? { q } : {}),
		...(kinds ? { kinds } : {}),
		...(sources ? { sources } : {}),
		...(tagIds.length ? { tagIds } : {}),
		...(subtype ? { subtype } : {}),
		...(formatDetail ? { formatDetail } : {}),
		...(engagementType ? { engagementType } : {}),
		...(sort ? { sort } : {}),
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
		smart: smart === "1" ? true : smart === "0" ? false : null,
	};
}

/** The URL form of a search, in a fixed key order. The page is written only past the first. */
export function toLibrarySearchParams(input: LibrarySearchInput & { smart?: boolean | null }): URLSearchParams {
	const params = new URLSearchParams();
	if (input.q) params.set("q", input.q);
	for (const kind of input.kinds ?? []) params.append("type", kind);
	for (const source of input.sources ?? []) params.append("source", source);
	for (const tagId of input.tagIds ?? []) params.append("tag", tagId);
	if (input.subtype) params.set("subtype", input.subtype);
	if (input.formatDetail) params.set("format", input.formatDetail);
	if (input.engagementType) params.set("engagement", input.engagementType);
	if (input.sort) params.set("sort", input.sort);
	const page = Math.floor((input.offset ?? 0) / (input.limit ?? PAGE_SIZE)) + 1;
	if (page > 1) params.set("page", String(page));
	if (input.smart === true) params.set("smart", "1");
	if (input.smart === false) params.set("smart", "0");
	return params;
}

/** False only for the bare home. A sort or a later page counts: that is how a member browses everything. */
export function hasActiveSearch(search: LibrarySearchInput): boolean {
	return Boolean(
		search.q ||
			search.kinds?.length ||
			search.sources?.length ||
			search.tagIds?.length ||
			search.subtype ||
			search.formatDetail ||
			search.engagementType ||
			search.sort ||
			(search.offset ?? 0) > 0,
	);
}

/** Which facet filters the form offers. They follow the chosen types (5.4), but one already in the URL always shows, so it can be cleared. */
export function facetsFor(search: LibrarySearchInput): { subtypes: readonly string[]; showSubtype: boolean; showModuleFacets: boolean } {
	const doc = Boolean(search.kinds?.includes("code_document"));
	const reading = Boolean(search.kinds?.includes("reading"));
	const subtypes = doc || reading ? [...(doc ? SUBTYPES.code_document : []), ...(reading ? SUBTYPES.reading : [])] : SUBTYPE_VALUES;
	return {
		subtypes,
		showSubtype: doc || reading || Boolean(search.subtype),
		showModuleFacets: doc || Boolean(search.formatDetail || search.engagementType),
	};
}

/** Drops facets that the chosen types no longer allow, so toggling a type off never leaves a hidden filter behind. */
export function dropStaleFacets(search: LibrarySearchInput): LibrarySearchInput {
	if (!search.kinds?.length) return search;
	const { subtypes, showSubtype } = facetsFor({ kinds: search.kinds });
	const next = { ...search };
	if (next.subtype && !(showSubtype && subtypes.includes(next.subtype))) delete next.subtype;
	if (!search.kinds.includes("code_document")) {
		delete next.formatDetail;
		delete next.engagementType;
	}
	return next;
}

/** The list with `item` added, or taken out when it is already there. An empty list becomes `undefined`, which the URL leaves out. */
export function toggleValue<T extends string>(list: readonly T[] | undefined, item: T): T[] | undefined {
	const next = list?.includes(item) ? list.filter((entry) => entry !== item) : [...(list ?? []), item];
	return next.length ? next : undefined;
}

/** A filter or sort change on top of the search as it stands now: back to the first page, stale facets dropped. */
export function applySearchChange<T extends LibrarySearchInput>(current: T, patch: Partial<LibrarySearchInput>): T {
	return { ...dropStaleFacets({ ...current, ...patch }), offset: 0 } as T;
}

/** The sort the results really use: relevance has nothing to rank against without a query, so it is newest. */
export function effectiveSort(search: LibrarySearchInput): (typeof SORTS)[number] {
	if (search.sort === "relevance") return search.q ? "relevance" : "newest";
	return search.sort ?? (search.q ? "relevance" : "newest");
}

/** Where a results page sits. `prev` never points past the last real page, so a link from a page past the end lands on results. */
export function pageInfo(total: number, offset: number, limit: number = PAGE_SIZE): { page: number; pages: number; prev: number | null; next: number | null } {
	const page = Math.floor(Math.max(0, offset) / limit) + 1;
	const pages = Math.max(1, Math.ceil(total / limit));
	return { page, pages, prev: page > 1 ? Math.min(page - 1, pages) : null, next: page < pages ? page + 1 : null };
}
