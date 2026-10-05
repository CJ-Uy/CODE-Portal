export const MERGE_TAGS = ["first_name", "full_name", "nickname", "batch", "email"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Record<MergeTag, string>;
export type MergeOverrides = Record<string, Partial<Omit<MergeValues, "email">>>;
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

const TAG_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;
// Loose on purpose: anything inside braces that is not exactly a known tag (First_Name, first-name, batch2) is reported.
const ANY_TAG_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const isMergeTag = (value: string): value is MergeTag => (MERGE_TAGS as readonly string[]).includes(value);
const canonicalTag = (value: string): MergeTag | null => {
	const tag = value === "firstname" ? "first_name" : value === "fullname" ? "full_name" : value;
	return isMergeTag(tag) ? tag : null;
};

export function findUnknownTags(input: string): string[] {
	const unknown = new Set<string>();
	for (const match of input.matchAll(ANY_TAG_PATTERN)) if (!canonicalTag(match[1])) unknown.add(match[1]);
	return [...unknown];
}

/** Replaces known tags with `resolve(tag)`. Unknown tags stay as written; validation rejects them before save. */
export function replaceTags(input: string, resolve: (tag: MergeTag) => string): string {
	return input.replace(TAG_PATTERN, (whole, tag: string) => {
		const canonical = canonicalTag(tag);
		return canonical ? resolve(canonical) : whole;
	});
}

export function usedMergeTags(input: string): MergeTag[] {
	return [...new Set([...input.matchAll(TAG_PATTERN)].flatMap((match) => {
		const tag = canonicalTag(match[1]);
		return tag ? [tag] : [];
	}))];
}

const firstWord = (value: string | null) => (value?.includes(",") ? value.slice(value.indexOf(",") + 1) : value)?.trim().split(/\s+/)[0] || null;

export function mergeValuesFor(member: MergeMember, overrides: MergeOverrides = {}): MergeValues {
	const fullName = member.fullName?.trim() || member.name?.trim() || "";
	const firstName = firstWord(member.fullName) ?? firstWord(member.name) ?? (member.nickname?.trim() || "there");
	const values: MergeValues = {
		first_name: firstName,
		full_name: fullName || firstName,
		nickname: member.nickname?.trim() || firstName,
		batch: member.batch?.trim() || "",
		email: member.email,
	};
	Object.assign(values, overrides[member.email.trim().toLowerCase()]);
	// Values reach the subject line; a CR/LF there would allow header injection.
	for (const tag of MERGE_TAGS) values[tag] = values[tag].replace(/[\r\n]+/g, " ");
	return values;
}

/** Flags absent source data even when the renderer supplies a friendly fallback. */
export function missingMergeTags(member: MergeMember, tags: MergeTag[], overrides: MergeOverrides = {}): MergeTag[] {
	const custom = overrides[member.email.trim().toLowerCase()] ?? {};
	const hasName = Boolean(firstWord(member.fullName) || firstWord(member.name) || member.nickname?.trim());
	return tags.filter((tag) => {
		if (tag !== "email" && Object.hasOwn(custom, tag)) return !custom[tag]?.trim();
		if (tag === "batch") return !member.batch?.trim();
		if (tag === "email") return !member.email.trim();
		return !hasName;
	});
}
