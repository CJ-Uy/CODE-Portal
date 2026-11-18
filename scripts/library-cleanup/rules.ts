/**
 * Cleanup rules for library text that came from the old content-library sheet.
 * Pure functions, no item data. Per-item fixes live in a private overrides file under .local/, never in this repo.
 */

/** Titles the sheet used when it had no real name. */
const PLACEHOLDER_TITLES = new Set(["", "*", "-", "unknown", "untitled", "n/a", "tbd"]);
/** Author cells that mean "nobody recorded". */
const PLACEHOLDER_AUTHORS = new Set(["", "unknown", "n/a", "none", "-"]);

/** Misspellings seen in sheet topics and titles. Whole words only, matched case-sensitively. */
export const TYPO_FIXES: Record<string, string> = {
	Collabroation: "Collaboration",
	Acountability: "Accountability",
	Analaysis: "Analysis",
	Advocay: "Advocacy",
	Porass: "Porras",
};

const fixTypos = (text: string) => text.replace(/[A-Za-z]+/g, (word) => TYPO_FIXES[word] ?? word);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export const isPlaceholderTitle = (title: string) => PLACEHOLDER_TITLES.has(title.trim().toLowerCase());

/**
 * Undoes the old import's line join. It turned each line break in a title cell into "; ", so
 * "The product design; sprint:; decide" reads as three parts. Only for text that went through that join:
 * it cannot tell those from a real semicolon, so never run it on a fresh sheet cell.
 */
export function undoLineJoin(joined: string): string {
	return joined.replace(/([,:])\s*;\s*/g, "$1 ").replace(/\s*;\s*/g, " ");
}

/** A title from a sheet cell: line breaks become spaces, known misspellings and redaction markers are made consistent. Real semicolons stay. */
export function cleanTitle(raw: string): string {
	return squash(fixTypos(raw.replace(/\s*\n\s*/g, " "))).replace(/\{redacted\}|\[redacted\]/gi, "[Redacted]");
}

/** A topics line: line breaks become commas, dangling commas go, and known misspellings are fixed. */
export function cleanTopics(raw: string): string {
	const joined = raw.replace(/\s*\n\s*/g, ", ");
	return squash(fixTypos(joined))
		.replace(/\s*,\s*(?=,)/g, "")
		.replace(/\s*,\s*/g, ", ")
		.replace(/[,;\s]+$/, "");
}

/** One author name, tidied; null when the sheet only said "unknown". */
export function cleanAuthor(raw: string): string | null {
	const name = squash(raw)
		.replace(/,(?=\S)/g, ", ")
		.replace(/\.$/, "")
		.replace(/,\s*,/g, ",");
	return PLACEHOLDER_AUTHORS.has(name.toLowerCase()) ? null : name;
}

/**
 * The title to show when the sheet gave none. Prefers the file code with its first topic ("IDF-018: Motivation"),
 * then the first topic, then the code alone. Null means a person has to name it.
 */
export function fallbackTitle(code: string | null, topics: string[]): string | null {
	const topic = topics.map((t) => cleanTitle(t)).find((t) => t && !isPlaceholderTitle(t)) ?? null;
	if (code && topic) return `${code}: ${topic}`;
	return topic ?? code ?? null;
}

/** The title to store: the cleaned sheet title, or a fallback when the sheet only had a placeholder. */
export function titleFor(raw: string, code: string | null, topics: string[]): string | null {
	const cleaned = cleanTitle(raw);
	return isPlaceholderTitle(cleaned) ? fallbackTitle(code, topics) : cleaned;
}
