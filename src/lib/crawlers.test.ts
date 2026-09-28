import { describe, expect, it } from "vitest";
import { isCrawlerUserAgent, renderPreviewHtml } from "./crawlers";

describe("isCrawlerUserAgent", () => {
	it("detects common social and search crawlers", () => {
		expect(isCrawlerUserAgent("facebookexternalhit/1.1")).toBe(true);
		expect(isCrawlerUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
		expect(isCrawlerUserAgent("Mozilla/5.0 ... Discordbot/2.0")).toBe(true);
		expect(isCrawlerUserAgent("TwitterBot")).toBe(true);
	});

	it("treats real browsers and null as non-crawlers", () => {
		expect(isCrawlerUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false);
		expect(isCrawlerUserAgent(null)).toBe(false);
	});
});

describe("renderPreviewHtml", () => {
	it("emits escaped OG meta tags and a refresh fallback", () => {
		const html = renderPreviewHtml({
			title: 'A "great" link',
			description: "Body & more",
			imageUrl: "https://cdn.example/img.png",
			destinationUrl: "https://example.com/dest",
		});
		expect(html).toContain('<meta property="og:title" content="A &quot;great&quot; link">');
		expect(html).toContain('<meta property="og:description" content="Body &amp; more">');
		expect(html).toContain('<meta property="og:image" content="https://cdn.example/img.png">');
		expect(html).toContain('content="0;url=https://example.com/dest"');
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
	});

	it("omits image and description tags when they are null", () => {
		const html = renderPreviewHtml({
			title: "Title only",
			description: null,
			imageUrl: null,
			destinationUrl: "https://example.com",
		});
		expect(html).not.toContain("og:image");
		expect(html).not.toContain("og:description");
	});
});
