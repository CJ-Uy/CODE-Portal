/**
 * Raw sheet topic -> library tag names, or "drop" for noise. Pure: the import CLI does the file I/O.
 * The real map lives in .local/library-import/tag-map.json and is never committed.
 */
export type TagMap = Record<string, string[] | "drop">;

/** Lowercase words only, "&" as "and", "organization(al)" as "org", so "Organizational Culture" meets "Org Culture". */
function norm(text: string): string {
	return text
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/\borgani[sz]ation(al)?\b/g, "org")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** A tag's match keys: its name, each "/" alternative and each bracketed abbreviation ("Design Thinking / HCD" -> design thinking, hcd). */
function keysOf(tag: string): string[] {
	const abbreviations = [...tag.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
	const base = tag.replace(/\([^)]*\)/g, " ");
	return [...new Set([base, ...base.split("/"), ...abbreviations].map(norm).filter(Boolean))];
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[b.length];
}

const hasWords = (text: string, words: string) => ` ${text} `.includes(` ${words} `);

/**
 * Exact or near-exact matches first (a typo or two, scaled to length). Failing those, a tag whose key appears in the
 * topic as whole words, or a topic of 4+ characters that appears in a tag key ("Burnout" -> "Well-being & Burnout").
 * Unmapped topics get [] so assertTagMapComplete names them.
 */
export function proposeTagMap(rawTopics: string[], tags: readonly string[]): TagMap {
	const tagKeys = tags.map((tag) => ({ tag, keys: keysOf(tag) }));
	const map: TagMap = {};
	for (const raw of rawTopics) {
		const topic = norm(raw);
		const near = (key: string) => key === topic || (topic.length >= 5 && editDistance(key, topic) <= (topic.length >= 10 ? 2 : 1));
		const loose = (key: string) => (key.length >= 3 && hasWords(topic, key)) || (topic.length >= 4 && hasWords(key, topic));
		const exact = tagKeys.filter(({ keys }) => keys.some(near));
		map[raw] = (exact.length > 0 ? exact : tagKeys.filter(({ keys }) => keys.some(loose))).map(({ tag }) => tag);
	}
	return map;
}

/** Throws listing every topic that is neither mapped nor "drop", and (given the tag list) every mapping to a tag that does not exist. */
export function assertTagMapComplete(map: TagMap, tags?: readonly string[]): void {
	const unmapped = Object.entries(map)
		.filter(([, value]) => value !== "drop" && (!Array.isArray(value) || value.length === 0))
		.map(([raw]) => raw);
	if (unmapped.length > 0) throw new Error(`Map these topics to a tag or "drop": ${unmapped.join(" | ")}`);
	if (!tags) return;
	const unknown = Object.values(map).flatMap((value) => (value === "drop" ? [] : value.filter((tag) => !tags.includes(tag))));
	if (unknown.length > 0) throw new Error(`Unknown tags in the tag map: ${[...new Set(unknown)].join(" | ")}`);
}
