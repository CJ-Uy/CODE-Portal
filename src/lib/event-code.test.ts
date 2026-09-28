import { describe, expect, it } from "vitest";
import { EVENT_CODE_ALPHABET, EVENT_CODE_LENGTH, generateEventCode, normalizeEventCode } from "./event-code";

describe("event share codes", () => {
	it("excludes every ambiguous glyph a member could mistype off a poster", () => {
		for (const char of ["I", "L", "O", "U", "0", "1"]) {
			expect(EVENT_CODE_ALPHABET).not.toContain(char);
		}
	});

	it("generates codes of the fixed length using only the alphabet", () => {
		for (let i = 0; i < 200; i += 1) {
			const code = generateEventCode();
			expect(code).toHaveLength(EVENT_CODE_LENGTH);
			for (const char of code) expect(EVENT_CODE_ALPHABET).toContain(char);
		}
	});

	it("does not bias toward the front of the alphabet", () => {
		// Rejection sampling exists so `byte % 30` cannot favour the first 16 symbols.
		// The tail of the alphabet must show up at a broadly comparable rate to the head.
		const head = new Set(EVENT_CODE_ALPHABET.slice(0, 16));
		let headCount = 0;
		let total = 0;
		for (let i = 0; i < 400; i += 1) {
			for (const char of generateEventCode()) {
				if (head.has(char)) headCount += 1;
				total += 1;
			}
		}
		// Unbiased share of the first 16 of 30 symbols is 0.533. A modulo bias pushes it to ~0.633.
		expect(headCount / total).toBeLessThan(0.60);
	});

	it("normalizes lowercase input so a typed code still resolves", () => {
		const code = generateEventCode();
		expect(normalizeEventCode(code.toLowerCase())).toBe(code);
		expect(normalizeEventCode(` ${code} `)).toBe(code);
	});

	it("rejects malformed codes so the resolver can 404 without a query", () => {
		expect(normalizeEventCode(null)).toBeNull();
		expect(normalizeEventCode("")).toBeNull();
		expect(normalizeEventCode("ABC")).toBeNull();
		expect(normalizeEventCode("ABCDEFG")).toBeNull();
		expect(normalizeEventCode("ABC0EF")).toBeNull();
		expect(normalizeEventCode("ABC-EF")).toBeNull();
	});
});
