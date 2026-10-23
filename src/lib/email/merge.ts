export const MERGE_TAGS = ["first_name", "full_name", "nickname", "batch", "email"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
/** Profile fields are always present; sheet columns add more keys. */
export type MergeValues = Record<MergeTag, string> & Record<string, string>;
/** Per-recipient corrections keyed by lowercase email. Keys are profile fields or sheet variables, never `email`. */
export type MergeOverrides = Record<string, Record<string, string>>;
/** Rows imported from a spreadsheet. Each column becomes `{{variable}}`; rows are keyed by lowercase email. */
export type MergeSheet = {
	name: string;
	importedAt: string;
	keyColumn: string;
	columns: { header: string; variable: string }[];
	rows: Record<string, Record<string, string>>;
};
export type MergeMember = {
	email: string;
	name: string | null;
	fullName: string | null;
	nickname: string | null;
	batch: string | null;
};

export const MERGE_TAG_LABELS: Record<MergeTag, string> = {
	first_name: "First name",
	full_name: "Full name",
	nickname: "Nickname",
	batch: "Batch",
	email: "Email",
};

export const SAMPLE_MERGE_VALUES: MergeValues = {
	first_name: "Juan",
	full_name: "Juan Dela Cruz",
	nickname: "Juan",
	batch: "2027",
	email: "juan.delacruz@student.ateneo.edu",
};

/** What a sheet column or correction may be called: lowercase letters, digits and underscores. */
export const VARIABLE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const TAG_PATTERN = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;
// Loose on purpose: anything inside braces that is not a well-formed name (First_Name, first-name) is reported.
const ANY_TAG_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
export const isMergeTag = (value: string): value is MergeTag => (MERGE_TAGS as readonly string[]).includes(value);
const canonicalTag = (value: string): string | null => {
	const tag = value === "firstname" ? "first_name" : value === "fullname" ? "full_name" : value;
	return VARIABLE_PATTERN.test(tag) ? tag : null;
};

export const mergeLabel = (tag: string) => (isMergeTag(tag) ? MERGE_TAG_LABELS[tag] : tag);

/** Tags that can never be filled because their name is malformed. Unfilled but well-formed names are checked against the sheet. */
export function findUnknownTags(input: string): string[] {
	const unknown = new Set<string>();
	for (const match of input.matchAll(ANY_TAG_PATTERN)) if (!canonicalTag(match[1])) unknown.add(match[1]);
	return [...unknown];
}

/** Replaces well-formed tags with `resolve(tag)`. Malformed tags stay as written; validation rejects them before save. */
export function replaceTags(input: string, resolve: (tag: string) => string): string {
	return input.replace(TAG_PATTERN, (whole, tag: string) => {
		const canonical = canonicalTag(tag);
		return canonical ? resolve(canonical) : whole;
	});
}

/** For subjects and preview text: a CR or LF in a header would allow header injection. */
export const replaceTagsOneLine = (input: string, values: Record<string, string>) => replaceTags(input, (tag) => values[tag] ?? "").replace(/[\r\n]+/g, " ");

export function usedMergeTags(input: string): string[] {
	return [...new Set([...input.matchAll(TAG_PATTERN)].flatMap((match) => {
		const tag = canonicalTag(match[1]);
		return tag ? [tag] : [];
	}))];
}

/** Variables a campaign can fill: profile fields, sheet columns and any correction key. */
export function knownVariables(sheet: MergeSheet | null, overrides: MergeOverrides = {}): Set<string> {
	const known = new Set<string>(MERGE_TAGS);
	for (const column of sheet?.columns ?? []) known.add(column.variable);
	for (const values of Object.values(overrides)) for (const key of Object.keys(values)) known.add(key);
	return known;
}

const firstWord = (value: string | null) => (value?.includes(",") ? value.slice(value.indexOf(",") + 1) : value)?.trim().split(/\s+/)[0] || null;
const keyOf = (email: string) => email.trim().toLowerCase();

/** Profile values, then non-blank sheet cells, then this email's corrections. */
export function mergeValuesFor(member: MergeMember, overrides: MergeOverrides = {}, sheet: MergeSheet | null = null): MergeValues {
	const fullName = member.fullName?.trim() || member.name?.trim() || "";
	const firstName = firstWord(member.fullName) ?? firstWord(member.name) ?? (member.nickname?.trim() || "there");
	const values: MergeValues = {
		first_name: firstName,
		full_name: fullName || firstName,
		nickname: member.nickname?.trim() || firstName,
		batch: member.batch?.trim() || "",
		email: member.email,
	};
	const key = keyOf(member.email);
	for (const column of sheet?.columns ?? []) if (!isMergeTag(column.variable)) values[column.variable] = "";
	for (const [name, value] of Object.entries(sheet?.rows[key] ?? {})) if (name !== "email" && value.trim()) values[name] = value;
	for (const [name, value] of Object.entries(overrides[key] ?? {})) if (name !== "email") values[name] = value;
	// Keep line breaks for message bodies; subjects go through replaceTagsOneLine.
	for (const name of Object.keys(values)) values[name] = values[name].replace(/\r\n?/g, "\n");
	return values;
}

/** Flags absent source data even when the renderer supplies a friendly fallback. */
export function missingMergeTags(member: MergeMember, tags: string[], overrides: MergeOverrides = {}, sheet: MergeSheet | null = null): string[] {
	const custom = overrides[keyOf(member.email)] ?? {};
	const row = sheet?.rows[keyOf(member.email)] ?? {};
	const hasName = Boolean(firstWord(member.fullName) || firstWord(member.name) || member.nickname?.trim());
	return tags.filter((tag) => {
		if (tag === "email") return !member.email.trim();
		if (Object.hasOwn(custom, tag)) return !custom[tag]?.trim();
		if (row[tag]?.trim()) return false;
		if (tag === "batch") return !member.batch?.trim();
		if (isMergeTag(tag)) return !hasName;
		return true;
	});
}
