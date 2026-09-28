import { z } from "zod";

const emailSchema = z.string().email();

export type ParsedEmailColumn = {
	/** Unique, lowercased, valid emails in first-seen order. */
	valid: string[];
	/** Tokens that failed email validation (lowercased, in order; not deduped). */
	invalid: string[];
	/** How many duplicate valid emails were collapsed out of `valid`. */
	dedupedInput: number;
};

/**
 * Canonical parser for a pasted column of emails (e.g. a Google Sheets column).
 * Splits on newlines/commas/semicolons/tabs — NOT spaces, so display-name forms
 * like `"Jane" <j@x.com>` stay a single token and fail validation rather than
 * being silently torn apart. Lowercases for dedupe/storage; no provider-specific
 * equivalence (no gmail dot/plus folding).
 */
export function parseEmailColumn(raw: string): ParsedEmailColumn {
	const tokens = raw
		.split(/[\n,;\t]+/)
		.map((t) => t.trim().toLowerCase())
		.filter((t) => t.length > 0);

	const validAll: string[] = [];
	const invalid: string[] = [];
	for (const token of tokens) {
		if (emailSchema.safeParse(token).success) validAll.push(token);
		else invalid.push(token);
	}

	const valid = [...new Set(validAll)];
	return { valid, invalid, dedupedInput: validAll.length - valid.length };
}
