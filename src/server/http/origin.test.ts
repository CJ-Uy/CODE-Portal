import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./origin";

describe("assertSameOrigin", () => {
	it("accepts a matching Origin header", () => {
		expect(() =>
			assertSameOrigin(
				new Request("https://portal.example/api/uploads", {
					method: "POST",
					headers: { Origin: "https://portal.example" },
				}),
			),
		).not.toThrow();
	});

	it("rejects a cross-origin mutation", () => {
		expect(() =>
			assertSameOrigin(
				new Request("https://portal.example/api/uploads", {
					method: "POST",
					headers: { Origin: "https://attacker.example" },
				}),
			),
		).toThrow("Cross-origin request rejected.");
	});

	it("rejects a mutation without an Origin header", () => {
		expect(() =>
			assertSameOrigin(new Request("https://portal.example/api/uploads", { method: "POST" })),
		).toThrow("Cross-origin request rejected.");
	});
});
