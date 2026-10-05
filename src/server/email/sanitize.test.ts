import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize";

describe("sanitizeEmailHtml", () => {
	it("drops scripts, styles, handlers, forms, and unsafe links", async () => {
		const html = await sanitizeEmailHtml(
			`<html><head><style>p{}</style></head><body><p onclick="x()" style="color:red">Hi <b>there</b></p><script>alert(1)</script><form><input></form><a href="javascript:alert(1)">bad</a><a href="https://ok.com" class="x">ok</a></body></html>`,
		);
		expect(html).not.toMatch(/script|onclick|style|form|input|javascript/i);
		expect(html).toContain("<p>Hi <b>there</b></p>");
		expect(html).toContain('<a href="https://ok.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
		expect(html).toContain("<a>bad</a>");
	});

	it("replaces images with their alt text so nothing remote loads", async () => {
		const html = await sanitizeEmailHtml(`<p><img src="https://tracker.example/p.gif" alt="Logo <x>"></p>`);
		expect(html).toBe("<p>[image: Logo &lt;x&gt;]</p>");
	});

	it.each([
		["xmp", "<xmp><img src=x onerror=alert(1)></xmp>"],
		["noframes", "<noframes><script>alert(1)</script></noframes>"],
		["noembed", "<noembed><img src=https://t.example/p.gif></noembed>"],
		["plaintext", "<plaintext><img src=x onerror=alert(1)><script>alert(1)</script>"],
	])("drops raw-text element %s without emitting its content", async (_name, vector) => {
		const html = await sanitizeEmailHtml("<p>a</p>" + vector);
		expect(html).not.toMatch(/<img|<script|onerror/i);
		expect(html).toContain("<p>a</p>");
	});
});
