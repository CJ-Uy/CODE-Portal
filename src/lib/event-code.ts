/**
 * Short, human-speakable share codes for events: ateneocode.org/events/K7P2QM
 *
 * The alphabet omits every visually ambiguous glyph, because these codes get read off
 * posters and slides: I/L/1 and O/0 are the pairs people mistype. U is dropped as well,
 * which makes accidental profanity far less likely on club material.
 */
export const EVENT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const EVENT_CODE_LENGTH = 6;

// 30^6 = 729,000,000.
const ALPHABET_SIZE = EVENT_CODE_ALPHABET.length;

// 256 is not a multiple of 30, so a plain `byte % 30` would favour the first 16 symbols.
// Reject the ragged tail instead: 240 = 8 * 30 is the largest usable multiple.
const REJECT_AT = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

export function generateEventCode(): string {
	let code = "";
	while (code.length < EVENT_CODE_LENGTH) {
		const bytes = new Uint8Array(EVENT_CODE_LENGTH);
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte >= REJECT_AT) continue;
			code += EVENT_CODE_ALPHABET[byte % ALPHABET_SIZE];
			if (code.length === EVENT_CODE_LENGTH) break;
		}
	}
	return code;
}

/**
 * Uppercases and shape-validates a code from a URL. Returns null for anything malformed so
 * the resolver can 404 without touching the database.
 */
export function normalizeEventCode(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const upper = raw.trim().toUpperCase();
	if (upper.length !== EVENT_CODE_LENGTH) return null;
	for (const char of upper) {
		if (!EVENT_CODE_ALPHABET.includes(char)) return null;
	}
	return upper;
}
