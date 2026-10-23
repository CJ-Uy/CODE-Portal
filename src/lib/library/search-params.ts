import type { LibrarySearchInput } from "@/db/repositories/library";
import { ENGAGEMENT_TYPES, FORMAT_DETAILS, LIBRARY_KINDS, LIBRARY_SOURCES, SUBTYPES } from "./taxonomy";

// The library list and its URL: one place that decides which query values are believed.

/** Rows per load: the first load comes with the page, the rest as the member scrolls. */
export const PAGE_SIZE = 24;

export const SORTS = ["relevance", "title", "newest", "most_saved", "most_read"] as const;
export const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
	relevance: "Relevance",
	title: "A to Z",
	newest: "Newest",
	most_saved: "Most saved",
	most_read: "Most read",
};
const SUBTYPE_VALUES: readonly string[] = [...SUBTYPES.code_document, ...SUBTYPES.reading];

const Q_MAX = 200;
const TAG_ID = /^ltg_[A-Za-z0-9_-]{1,60}$/;
const TAGS_MAX = 20;
// Smart-search chips the member removed: up to the 8 a search can show, each as long as a chip label can be.
const WITHOUT_MAX = 8;
const CHIP_MAX = 60;

export type RawParams = Record<string, string | string[] | undefined>;
/** `smart`: ?smart=1|0, which beats the member's switch for this request. `without`: removed chip labels, lowercase. */
export type ParsedLibrarySearch = LibrarySearchInput & { smart: boolean | null; without?: string[] };

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
	const smart = many(params.smart)[0];
	const without = [...new Set(many(params.without).map((label) => label.trim().toLowerCase()))].filter((label) => label && label.length <= CHIP_MAX).slice(0, WITHOUT_MAX);

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
		smart: smart === "1" ? true : smart === "0" ? false : null,
		...(without.length ? { without } : {}),
	};
}

/** The URL form of a search, in a fixed key order. It is also the key a scrolled list is remembered by. */
export function toLibrarySearchParams(input: LibrarySearchInput & { smart?: boolean | null; without?: string[] }): URLSearchParams {
	const params = new URLSearchParams();
	if (input.q) params.set("q", input.q);
	for (const kind of input.kinds ?? []) params.append("type", kind);
	for (const source of input.sources ?? []) params.append("source", source);
	for (const tagId of input.tagIds ?? []) params.append("tag", tagId);
	if (input.subtype) params.set("subtype", input.subtype);
	if (input.formatDetail) params.set("format", input.formatDetail);
	if (input.engagementType) params.set("engagement", input.engagementType);
	if (input.sort) params.set("sort", input.sort);
	if (input.smart === true) params.set("smart", "1");
	if (input.smart === false) params.set("smart", "0");
	for (const label of input.without ?? []) params.append("without", label);
	return params;
}

/** The params of a query string the way a page receives them: a repeated key becomes a list. */
export function rawParams(query: string): RawParams {
	const params = new URLSearchParams(query);
	return Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key).length > 1 ? params.getAll(key) : (params.get(key) ?? undefined)]));
}

/** Whether a query or a filter narrows the list. A sort only reorders it, so the home keeps its Latest row. */
export function hasActiveSearch(search: LibrarySearchInput): boolean {
	return Boolean(
		search.q || search.kinds?.length || search.sources?.length || search.tagIds?.length || search.subtype || search.formatDetail || search.engagementType,
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

/** A filter or sort change on top of the search as it stands now, stale facets dropped. */
export function applySearchChange<T extends LibrarySearchInput>(current: T, patch: Partial<T>): T {
	return dropStaleFacets({ ...current, ...patch }) as T;
}

/**
 * The sort the list really uses. With a query it is relevance; without one it is A to Z, a steady order like a sheet's,
 * since the Latest row above the list already shows what is new. Relevance has nothing to rank without a query.
 */
export function effectiveSort(search: LibrarySearchInput): (typeof SORTS)[number] {
	if (search.sort === "relevance") return search.q ? "relevance" : "title";
	return search.sort ?? (search.q ? "relevance" : "title");
}
