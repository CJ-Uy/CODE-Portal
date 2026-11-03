/**
 * Where the next page of a library list starts: the order the list is read in and the last row's sort-key values.
 * The browser holds it between pages and sends it back, so reading one trusts nothing in it.
 */
export type LibraryCursor = { order: string; keys: (string | number)[] };

// Every order has at most four keys (a ranking, then published date, then id). A title key is at most 200 characters.
const KEYS_MAX = 4;
const KEY_TEXT_MAX = 300;
const CURSOR_MAX = 2_000;

export function encodeCursor(cursor: LibraryCursor): string {
	return JSON.stringify([cursor.order, ...cursor.keys]);
}

/** Null for anything that is not a cursor `encodeCursor` could have written. */
export function decodeCursor(raw: string): LibraryCursor | null {
	if (raw.length > CURSOR_MAX) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(data) || data.length < 2 || data.length > KEYS_MAX + 1) return null;
	const [order, ...keys] = data as unknown[];
	if (typeof order !== "string" || !order) return null;
	const valid = keys.every((key) => (typeof key === "number" && Number.isFinite(key)) || (typeof key === "string" && key.length <= KEY_TEXT_MAX));
	return valid ? { order, keys: keys as (string | number)[] } : null;
}
