export const MERGE_TAGS = ["first_name", "full_name", "nickname", "batch", "email"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Record<MergeTag, string>;
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
const isMergeTag = (value: string): value is MergeTag => (MERGE_TAGS as readonly string[]).includes(value);

export function findUnknownTags(input: string): string[] {
	const unknown = new Set<string>();
	for (const match of input.matchAll(TAG_PATTERN)) if (!isMergeTag(match[1])) unknown.add(match[1]);
	return [...unknown];
}

/** Replaces known tags with `resolve(tag)`. Unknown tags stay as written; validation rejects them before save. */
export function replaceTags(input: string, resolve: (tag: MergeTag) => string): string {
	return input.replace(TAG_PATTERN, (whole, tag: string) => (isMergeTag(tag) ? resolve(tag) : whole));
}

const firstWord = (value: string | null) => value?.trim().split(/\s+/)[0] || null;

export function mergeValuesFor(member: MergeMember): MergeValues {
	const fullName = member.fullName?.trim() || member.name?.trim() || "";
	const firstName = firstWord(member.fullName) ?? firstWord(member.name) ?? (member.nickname?.trim() || "there");
	return {
		first_name: firstName,
		full_name: fullName || firstName,
		nickname: member.nickname?.trim() || firstName,
		batch: member.batch?.trim() || "",
		email: member.email,
	};
}
