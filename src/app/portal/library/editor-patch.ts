import { isBlankBlock } from "@/lib/library/block-view";
import type { LibraryBlock } from "@/lib/library/blocks";
import type { LibraryAuthor, LibraryFormat, LibraryKind, LibrarySource } from "@/lib/library/taxonomy";
import { saveItemInputSchema, type SaveItemInput } from "./editor-input";

/** Everything the editor autosaves. Year and link stay as typed; they are checked before they are sent. */
export type Fields = {
	kind: LibraryKind;
	title: string;
	dek: string;
	source: LibrarySource;
	authors: LibraryAuthor[];
	subtype: string | null;
	formatDetail: string | null;
	engagementType: string | null;
	year: string;
	url: string;
	blocks: LibraryBlock[];
	tagIds: string[];
};
export type FieldKey = keyof Fields;
export type FieldErrors = Partial<Record<FieldKey, string>>;

export const FIELD_KEYS: FieldKey[] = ["kind", "title", "dek", "source", "authors", "subtype", "formatDetail", "engagementType", "year", "url", "blocks", "tagIds"];

export const FIELD_LABELS: Record<FieldKey, string> = {
	kind: "Type",
	title: "Title",
	dek: "Summary",
	source: "Source",
	authors: "Authors",
	subtype: "Kind of document",
	formatDetail: "Module format",
	engagementType: "Engagement type",
	year: "Year",
	url: "Link address",
	blocks: "The page",
	tagIds: "Tags",
};

/** What the editor knows about the item it is saving into. */
export type PatchContext = {
	itemId: string;
	/** Fixed for the life of the item: a type change carries it along. */
	format: LibraryFormat;
	/** Past draft. A live item has readers, so it must keep its link or its page. */
	live: boolean;
	/** What the item had when the page opened. A live item is only stopped from losing what it had. */
	had: { link: boolean; content: boolean };
};

/** What the schema takes for a field: an empty year or link means none, and an author row with no name is no author. */
export function normalizeField(key: FieldKey, value: Fields[FieldKey]): unknown {
	if ((key === "year" || key === "url") && value === "") return null;
	if (key === "authors") {
		return (value as LibraryAuthor[]).map((author) => ({ ...author, name: author.name.trim() })).filter((author) => author.name !== "");
	}
	return value;
}

function liveError(ctx: PatchContext, key: FieldKey, value: Fields[FieldKey]): string | null {
	if (!ctx.live) return null;
	if (key === "url" && ctx.format === "link" && ctx.had.link && normalizeField(key, value) === null) return "Add the link.";
	if (key === "blocks" && ctx.format === "page" && ctx.had.content && (value as LibraryBlock[]).every(isBlankBlock)) return "Write something on the page.";
	return null;
}

/** The schema's own words for a field (or, on a live item, why it may not be emptied), or null when it is fine. */
export function fieldError(ctx: PatchContext, key: FieldKey, value: Fields[FieldKey]): string | null {
	const result = saveItemInputSchema.shape[key].safeParse(normalizeField(key, value));
	if (!result.success) return result.error.issues[0]?.message ?? "Check this field.";
	return liveError(ctx, key, value);
}

const same = (key: FieldKey, a: Fields[FieldKey], b: Fields[FieldKey]) =>
	key === "blocks" ? a === b : JSON.stringify(normalizeField(key, a)) === JSON.stringify(normalizeField(key, b));

/**
 * What changed since the last save. A valid change goes in `patch`; one that is not valid goes in `errors` and stays
 * out, so it cannot hold up the rest. The caller must not call that a save: `errors` is what is still unsaved.
 */
export function buildPatch(ctx: PatchContext, now: Fields, saved: Fields): { patch: SaveItemInput | null; keys: FieldKey[]; errors: FieldErrors } {
	const patch: Record<string, unknown> = { itemId: ctx.itemId };
	const keys: FieldKey[] = [];
	const errors: FieldErrors = {};
	for (const key of FIELD_KEYS) {
		if (same(key, now[key], saved[key])) continue;
		const error = fieldError(ctx, key, now[key]);
		if (error) {
			errors[key] = error;
			continue;
		}
		patch[key] = saveItemInputSchema.shape[key].parse(normalizeField(key, now[key]));
		keys.push(key);
	}
	if (keys.length === 0) return { patch: null, keys, errors };
	// A new kind keeps the format the item already has (a Book/paper stays a link, a Case study a file).
	if (keys.includes("kind")) patch.format = ctx.format;
	return { patch: patch as SaveItemInput, keys, errors };
}

/** True while anything the member typed is not stored: a change waiting to be saved, or one that is not valid yet. */
export function hasUnsaved(ctx: PatchContext, now: Fields, saved: Fields): boolean {
	const { patch, errors } = buildPatch(ctx, now, saved);
	return patch !== null || Object.keys(errors).length > 0;
}

/** Every field that is not valid right now, saved or not. `blocksError` lets a caller reuse a result it already has (a big page is not cheap to check). */
export function allFieldErrors(ctx: PatchContext, value: Fields, blocksError?: string | null): FieldErrors {
	const errors: FieldErrors = {};
	for (const key of FIELD_KEYS) {
		const error = key === "blocks" && blocksError !== undefined ? blocksError : fieldError(ctx, key, value[key]);
		if (error) errors[key] = error;
	}
	return errors;
}

/** "Year: Enter a year from 1900." for each field, so a message always says which field it is about. */
export function describeErrors(errors: FieldErrors): string[] {
	return FIELD_KEYS.flatMap((key) => (errors[key] ? [`${FIELD_LABELS[key]}: ${errors[key]}`] : []));
}
