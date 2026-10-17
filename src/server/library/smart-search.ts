import type { LibraryCard, LibraryRepository, LibrarySearchInput } from "@/db/repositories/library";
import type { LibraryTagsRepository } from "@/db/repositories/library-tags";
import type { MembersRepository } from "@/db/repositories/members";
import type { ParsedLibrarySearch } from "@/lib/library/search-params";
import type { Actor } from "@/server/auth/permissions";
import type { LibraryAi, LibraryVectors, SmartBindings } from "./ai";

/**
 * Smart search never writes a sentence. It suggests keyword chips, ranks results by meaning, and fills the Related shelf.
 * Anything that goes wrong (a model or index error, a timeout, output that does not parse) returns null, and the caller
 * runs plain search instead. Visibility is never decided here: every id goes back through `library.search` in D1.
 */

export type SmartRepos = { library: LibraryRepository; libraryTags: Pick<LibraryTagsRepository, "listTags"> };
export type SmartDeps = { ai: LibraryAi; vectorize: LibraryVectors; repos: SmartRepos; timeoutMs?: number };
export type SmartChip = { label: string; tagId?: string };
export type SmartFilters = Omit<LibrarySearchInput, "q" | "sort" | "limit" | "offset" | "onlyIds">;

/** How many results a smart search keeps; the page paginates over these. */
export const SMART_LIMIT = 50;
const QUERY_MAX = 200;
const TIMEOUT_MS = 1500;
const MAX_TAGS = 5;
const MAX_WORDS = 3;
const WORD_MAX = 40;
const CHIP_LIMIT = 20;
const RELATED_SIZE = 6;
// Reciprocal-rank fusion constant: the usual 60, so no single list's top spot dominates.
const RRF_K = 60;

const NO_KEYWORDS = { tags: [] as string[], words: [] as string[] };

/** JSON only (a ```json fence is tolerated): at most 5 tags from `tagNames` (any case, returned in the tag's own spelling) and at most 3 words. Anything else gives no chips. */
export function parseKeywordOutput(raw: string, tagNames: string[]): { tags: string[]; words: string[] } {
	return readKeywordOutput(raw, tagNames) ?? NO_KEYWORDS;
}

/** parseKeywordOutput, but null for output that is not the JSON asked for, so a search can say why it has no chips. */
function readKeywordOutput(raw: string, tagNames: string[]): { tags: string[]; words: string[] } | null {
	let data: unknown;
	try {
		data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1"));
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const { tags = [], words = [] } = data as Record<string, unknown>;
	if (!Array.isArray(tags) || !Array.isArray(words)) return null;

	const known = new Map(tagNames.map((name) => [name.toLowerCase(), name]));
	const pickedTags = new Set<string>();
	for (const tag of tags) {
		const name = typeof tag === "string" ? known.get(tag.trim().toLowerCase()) : undefined;
		if (name) pickedTags.add(name);
	}
	const pickedWords = new Map<string, string>();
	for (const word of words) {
		const clean = typeof word === "string" ? word.trim().replace(/\s+/g, " ") : "";
		if (clean && clean.length <= WORD_MAX && !known.has(clean.toLowerCase())) pickedWords.set(clean.toLowerCase(), clean);
	}
	return { tags: [...pickedTags].slice(0, MAX_TAGS), words: [...pickedWords.values()].slice(0, MAX_WORDS) };
}

/** Reciprocal-rank fusion: each list adds 1 / (k + rank) to an id. Ties keep the order the ids were first seen in. */
export function fuseRankings(...lists: string[][]): string[] {
	const score = new Map<string, number>();
	for (const list of lists) {
		[...new Set(list)].forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
	}
	return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)!);
}

/** Rejects with a TimeoutError, the same name AbortSignal.timeout gives an aborted model call. */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new DOMException("Smart search timed out.", "TimeoutError")), ms);
	});
	return Promise.race([task, expired]).finally(() => clearTimeout(timer));
}

/** Fixed text only: never the query, the item, or the error (which could quote either). */
function fellBack(reason: "timeout" | "error" | "invalid"): void {
	console.error(`Library smart search fell back: ${reason}`);
}

const reasonOf = (error: unknown) => ((error as { name?: unknown } | null)?.name === "TimeoutError" ? "timeout" : "error");

/** Vector ids are `${itemId}:${chunk}`; this is each item once, best chunk first. */
function itemIdsOf(vectorIds: string[]): string[] {
	return [...new Set(vectorIds.flatMap((id) => /^(.+):\d+$/.exec(id)?.[1] ?? []))];
}

const idsOf = (found: Promise<{ cards: LibraryCard[] }>) => found.then(({ cards }) => cards.map((card) => card.id));

export async function smartSearch(
	actor: Actor,
	q: string,
	deps: SmartDeps,
	options: { filters?: SmartFilters; without?: string[] } = {},
): Promise<{ chips: SmartChip[]; ids: string[] } | null> {
	const query = Array.from(q.trim()).slice(0, QUERY_MAX).join("");
	if (!query) return null;
	const filters = options.filters ?? {};
	const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
	try {
		const tags = (await deps.repos.libraryTags.listTags()).filter((tag) => tag.itemCount > 0);
		// One budget for both model calls; the signal also stops a call that is still running when the budget runs out.
		const signal = AbortSignal.timeout(timeoutMs);
		const [raw, vectorIds] = await withTimeout(
			Promise.all([
				deps.ai.keywords(query, tags.map((tag) => tag.name), signal),
				deps.ai
					.embed([query], signal)
					.then(([vector]) => deps.vectorize.query(vector, { topK: SMART_LIMIT }))
					.then(({ matches }) => itemIdsOf(matches.map((match) => match.id))),
			]),
			timeoutMs,
		);

		const keywords = readKeywordOutput(raw, tags.map((tag) => tag.name));
		// Unreadable output costs the chips, not the search: the ranking by meaning still stands.
		if (!keywords) fellBack("invalid");
		const tagIdOf = new Map(tags.map((tag) => [tag.name, tag.id]));
		const removed = new Set(options.without ?? []);
		const chips: SmartChip[] = [
			...(keywords?.tags ?? []).map((name) => ({ label: name, tagId: tagIdOf.get(name) })).filter((chip) => !filters.tagIds?.includes(chip.tagId!)),
			// A chip that only repeats the search adds nothing.
			...(keywords?.words ?? []).filter((word) => word.toLowerCase() !== query.toLowerCase()).map((word) => ({ label: word })),
		].filter((chip) => !removed.has(chip.label.toLowerCase()));

		// A chip is one more ranked list, not a hard filter: five tags ANDed together would leave almost nothing.
		// ponytail: one D1 search per chip (at most 9 in all); a single OR query if this ever shows up in latency.
		const [plainIds, ...wordLists] = await Promise.all([
			idsOf(deps.repos.library.search(actor, { ...filters, q: query, limit: SMART_LIMIT })),
			...chips.filter((chip) => !chip.tagId).map((chip) => idsOf(deps.repos.library.search(actor, { ...filters, q: chip.label, limit: CHIP_LIMIT }))),
		]);
		// A tag chip only boosts what the search already found. Unbound by the query, a wrong tag's most-saved item would
		// rank as high as plain search's best match. Word chips stay free to find more.
		const candidates = [...new Set([...vectorIds, ...plainIds])];
		const tagLists = candidates.length
			? await Promise.all(
					chips
						.filter((chip) => chip.tagId)
						.map((chip) => idsOf(deps.repos.library.search(actor, { ...filters, onlyIds: candidates, tagIds: [...(filters.tagIds ?? []), chip.tagId!], sort: "most_saved", limit: CHIP_LIMIT }))),
				)
			: [];
		const fused = fuseRankings(vectorIds, plainIds, ...wordLists, ...tagLists);
		if (fused.length === 0) return { chips, ids: [] };
		// The visibility filter. Vectorize knows nothing about drafts, confidential or deleted items; D1 does.
		const { cards } = await deps.repos.library.search(actor, { ...filters, onlyIds: fused, sort: "relevance", limit: SMART_LIMIT });
		return { chips, ids: cards.map((card) => card.id) };
	} catch (error) {
		fellBack(reasonOf(error));
		return null;
	}
}

/** Up to 6 items similar to this one by embedding, boosted by shared tags. Null (use `library.related`) when it is not indexed or anything fails. */
export async function smartRelated(actor: Actor, itemId: string, deps: Pick<SmartDeps, "vectorize" | "repos" | "timeoutMs">): Promise<string[] | null> {
	try {
		if (!(await deps.repos.library.getItem(actor, itemId))) return null;
		// Both Vectorize steps share one 1.5 s budget. Null from it means "not indexed".
		const similar = await withTimeout(
			deps.vectorize.getByIds([`${itemId}:0`]).then(async ([first]) => (first ? (await deps.vectorize.query(first.values, { topK: SMART_LIMIT })).matches : null)),
			deps.timeoutMs ?? TIMEOUT_MS,
		);
		if (!similar) return null;
		const byTags = await deps.repos.library.related(actor, itemId, CHIP_LIMIT);
		const fused = fuseRankings(
			itemIdsOf(similar.map((match) => match.id)).filter((id) => id !== itemId),
			byTags.map((card) => card.id),
		);
		if (fused.length === 0) return [];
		const { cards } = await deps.repos.library.search(actor, { onlyIds: fused, sort: "relevance", limit: RELATED_SIZE });
		return cards.map((card) => card.id);
	} catch (error) {
		fellBack(reasonOf(error));
		return null;
	}
}

/** The member's "Smart search" switch. Unreadable means off: no model call on a guess. */
export async function smartSearchPreference(members: Pick<MembersRepository, "getById">, actor: Actor): Promise<boolean> {
	const me = await members.getById(actor, actor.memberId).catch(() => null);
	return me?.librarySmartSearch ?? false;
}

/**
 * The library search page. Smart search runs only with bindings (the flag is on and AI + VECTORIZE exist), a query, and
 * the member's switch on (`?smart=1|0` wins over the switch for this request). It keeps the best 50 and the page
 * paginates over them; otherwise, or when it fails, this is plain search.
 */
export async function searchLibrary(
	actor: Actor,
	search: ParsedLibrarySearch,
	ctx: { smart: SmartBindings | null; preference: boolean; repos: SmartRepos; timeoutMs?: number },
): Promise<{ cards: LibraryCard[]; total: number; chips: SmartChip[] }> {
	if (ctx.smart && search.q && (search.smart ?? ctx.preference)) {
		const { kinds, sources, tagIds, subtype, formatDetail, engagementType } = search;
		const found = await smartSearch(
			actor,
			search.q,
			{ ...ctx.smart, repos: ctx.repos, timeoutMs: ctx.timeoutMs },
			{ filters: { kinds, sources, tagIds, subtype, formatDetail, engagementType }, without: search.without },
		);
		if (found) {
			const page = await ctx.repos.library.search(actor, { onlyIds: found.ids, sort: search.sort ?? "relevance", limit: search.limit, offset: search.offset });
			return { ...page, chips: found.chips };
		}
	}
	return { ...(await ctx.repos.library.search(actor, search)), chips: [] };
}
