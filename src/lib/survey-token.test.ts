import { describe, expect, it } from "vitest";
import { generateResponseToken, hashResponseToken } from "./survey-token";

describe("survey-token", () => {
	it("generates distinct, non-empty tokens", () => {
		const a = generateResponseToken();
		const b = generateResponseToken();
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThanOrEqual(20);
	});

	it("hashes a token to a stable 64-char hex digest", async () => {
		const hash = await hashResponseToken("token-abc");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		await expect(hashResponseToken("token-abc")).resolves.toBe(hash);
	});

	it("produces different hashes for different tokens", async () => {
		await expect(hashResponseToken("a")).resolves.not.toBe(await hashResponseToken("b"));
	});
});
