import { describe, expect, it } from "vitest";
import { shortLinkUrl } from "./urls";

describe("shortLinkUrl", () => {
	it("builds a public short-link URL from an origin and slug", () => {
		expect(shortLinkUrl("https://app.example/", "welcome")).toBe("https://app.example/welcome");
	});
});
