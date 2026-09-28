import { describe, expect, it } from "vitest";
import {
	deviceBucket,
	isValidDestinationUrl,
	isValidSlugFormat,
	normalizeSlug,
	RESERVED_SLUG_DEFAULTS,
} from "./links";

describe("normalizeSlug", () => {
	it("trims, lowercases, and strips one leading slash", () => {
		expect(normalizeSlug("  /YHK  ")).toBe("yhk");
		expect(normalizeSlug("Promo-2026")).toBe("promo-2026");
	});
});

describe("isValidSlugFormat", () => {
	it("accepts lowercase alphanumeric slugs with internal hyphens", () => {
		expect(isValidSlugFormat("welcome")).toBe(true);
		expect(isValidSlugFormat("promo-2026")).toBe(true);
	});
	it("rejects too-short, too-long, edge-hyphen, and illegal-character slugs", () => {
		expect(isValidSlugFormat("ab")).toBe(false);
		expect(isValidSlugFormat("a".repeat(33))).toBe(false);
		expect(isValidSlugFormat("-lead")).toBe(false);
		expect(isValidSlugFormat("trail-")).toBe(false);
		expect(isValidSlugFormat("double--hyphen")).toBe(false);
		expect(isValidSlugFormat("UPPER")).toBe(false);
		expect(isValidSlugFormat("has space")).toBe(false);
	});
});

describe("isValidDestinationUrl", () => {
	it("accepts http and https", () => {
		expect(isValidDestinationUrl("https://example.com/x")).toBe(true);
		expect(isValidDestinationUrl("http://example.com")).toBe(true);
	});
	it("rejects other protocols and garbage (open-redirect guard)", () => {
		expect(isValidDestinationUrl("javascript:alert(1)")).toBe(false);
		expect(isValidDestinationUrl("ftp://example.com")).toBe(false);
		expect(isValidDestinationUrl("data:text/html,x")).toBe(false);
		expect(isValidDestinationUrl("not a url")).toBe(false);
	});
});

describe("RESERVED_SLUG_DEFAULTS", () => {
	it("includes the route names slugs must not shadow", () => {
		expect(RESERVED_SLUG_DEFAULTS).toContain("portal");
		expect(RESERVED_SLUG_DEFAULTS).toContain("l");
		expect(RESERVED_SLUG_DEFAULTS).toContain("api");
		expect(RESERVED_SLUG_DEFAULTS).toContain("contact");
		expect(RESERVED_SLUG_DEFAULTS).toContain("_next");
	});
});

describe("deviceBucket", () => {
	it("classifies mobile and desktop user-agents", () => {
		expect(deviceBucket("Mozilla/5.0 (iPhone; CPU iPhone OS)")).toBe("mobile");
		expect(deviceBucket("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
		expect(deviceBucket(null)).toBe("desktop");
	});
});
