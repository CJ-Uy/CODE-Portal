import type { LibraryCardFields } from "./card-fields";

/**
 * What the library list remembers when a member leaves it, so coming back lands on the same row with the same rows loaded.
 * Kept in sessionStorage (this tab only). `key` is the list's search (its query string), so another search never restores it;
 * `to` is the path the member left for, so that page's way back can be a real Back.
 */
export type ListMemory = { key: string; to: string; cards: LibraryCardFields[]; nextCursor: string | null; scrollY: number; savedAt: number };

export const LIST_MEMORY_KEY = "library-list";
/** Older than this, the list opens fresh: the rows may have changed and the member has likely moved on. */
export const LIST_MEMORY_TTL_MS = 30 * 60_000;
/** More rows than this are not worth keeping: the list opens from the top instead. */
export const LIST_MEMORY_MAX_CARDS = 600;

export function writeListMemory(memory: ListMemory): string | null {
	return memory.cards.length > LIST_MEMORY_MAX_CARDS ? null : JSON.stringify(memory);
}

/** The remembered list, or null when there is none, it is stale, or it is not one this code wrote. */
export function readListMemory(raw: string | null, now: number): ListMemory | null {
	if (!raw) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const memory = data as Partial<ListMemory>;
	if (typeof memory.key !== "string" || typeof memory.to !== "string" || !memory.to.startsWith("/")) return null;
	if (typeof memory.savedAt !== "number" || now - memory.savedAt > LIST_MEMORY_TTL_MS || now < memory.savedAt) return null;
	if (!Array.isArray(memory.cards) || memory.cards.length > LIST_MEMORY_MAX_CARDS || !memory.cards.every((card) => typeof card?.id === "string" && typeof card.title === "string")) return null;
	if (typeof memory.scrollY !== "number" || !Number.isFinite(memory.scrollY) || memory.scrollY < 0) return null;
	if (memory.nextCursor !== null && typeof memory.nextCursor !== "string") return null;
	return memory as ListMemory;
}

/** The library list a remembered search opens. */
export function listHref(key: string): string {
	return key ? `/portal/library?${key}` : "/portal/library";
}
