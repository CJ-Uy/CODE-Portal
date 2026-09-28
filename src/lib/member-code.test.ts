import { describe, expect, it } from "vitest";
import { decodeMemberCode, encodeMemberCode } from "./member-code";

describe("member code codec", () => {
	it("round-trips a member id", () => {
		const encoded = encodeMemberCode("mem_abc123");
		expect(decodeMemberCode(encoded)).toBe("mem_abc123");
	});

	it("is stable for the same id (no rotation)", () => {
		expect(encodeMemberCode("mem_abc123")).toBe(encodeMemberCode("mem_abc123"));
	});

	it("rejects a payload that is not a CODE member token", () => {
		expect(decodeMemberCode("not-a-code")).toBeNull();
		expect(decodeMemberCode("")).toBeNull();
	});
});
