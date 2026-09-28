import { describe, expect, it } from "vitest";
import { clientIpFromRequest, RATE_LIMITS, tooManyRequests } from "./policies";

function req(headers: Record<string, string>): Request {
	return new Request("https://portal.example.com/api/auth/signin/google", { method: "POST", headers });
}

describe("clientIpFromRequest", () => {
	it("prefers cf-connecting-ip", () => {
		expect(clientIpFromRequest(req({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe(
			"9.9.9.9",
		);
	});

	it("falls back to the first x-forwarded-for hop", () => {
		expect(clientIpFromRequest(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
	});

	it("returns a stable sentinel when no ip header is present", () => {
		expect(clientIpFromRequest(req({}))).toBe("unknown");
	});
});

describe("RATE_LIMITS", () => {
	it("defines the three hardened policies", () => {
		expect(RATE_LIMITS.authSignin.limit).toBeGreaterThan(0);
		expect(RATE_LIMITS.linkCreate.limit).toBeGreaterThan(0);
		expect(RATE_LIMITS.scanSubmit.limit).toBeGreaterThan(0);
	});
});

describe("tooManyRequests", () => {
	it("returns a 429 with a Retry-After header", () => {
		const now = Date.now();
		const res = tooManyRequests({ allowed: false, remaining: 0, resetAt: now + 30_000 });
		expect(res.status).toBe(429);
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
	});
});
