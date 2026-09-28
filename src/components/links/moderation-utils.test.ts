import { describe, expect, it } from "vitest";
import { linkModerationPageUrl } from "./moderation-utils";

describe("linkModerationPageUrl", () => {
	it("builds the all-links API URL with limit and offset", () => {
		expect(linkModerationPageUrl(50)).toBe("/api/links?scope=all&limit=50&offset=50");
	});
});
