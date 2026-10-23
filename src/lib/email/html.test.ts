import { describe, expect, it } from "vitest";
import { baseHtmlTemplate } from "./base-html";
import { htmlToText, lintEmailHtml, previewDocument, sanitizeCss, sanitizeEmailHtml } from "./html";
import { findUnknownTags, isMergeTag, usedMergeTags } from "./merge";

const clean = (html: string) => sanitizeEmailHtml(html).body;

describe("sanitizeEmailHtml", () => {
	it("removes scripts, event handlers and dangerous elements with their content", () => {
		const out = clean('<p onclick="x()" onmouseover=y>Hi<script>alert(1)</script></p><iframe src="https://x.com">no</iframe><svg><text>s</text></svg><form><button>Go</button></form>');
		expect(out).toBe("<p>Hi</p>Go");
	});
	it("allows only https, mailto, tel and anchor links, decoding entities before checking", () => {
		expect(clean('<a href="javascript:alert(1)">a</a>')).toBe('<a href="#">a</a>');
		expect(clean('<a href="&#106;avascript&#58;alert(1)">a</a>')).toBe('<a href="#">a</a>');
		expect(clean('<a href="java&#x09;script:x">a</a>')).toBe('<a href="#">a</a>');
		expect(clean('<a href=" https://x.com/?a=1&amp;b=2" target="_blank">a</a>')).toBe('<a href="https://x.com/?a=1&amp;b=2" target="_blank">a</a>');
		expect(clean('<a href="mailto:hi@x.com">m</a><a href="#top">t</a>')).toBe('<a href="mailto:hi@x.com">m</a><a href="#top">t</a>');
		expect(clean('<img src="http://x.com/a.png" alt="A"><img src="data:image/png;base64,AA" alt="B">')).toBe('<img alt="A"><img alt="B">');
		expect(clean('<td background="https://x.com/bg.png">x</td>')).toBe('<td background="https://x.com/bg.png">x</td>');
	});
	it("keeps layout attributes, drops unknown ones and re-escapes values", () => {
		expect(clean(`<table role="presentation" width="600" data-x="1" bgcolor="#fff" class='a "b'><tr><td align=center>x</td></tr></table>`)).toBe(
			'<table role="presentation" width="600" bgcolor="#fff" class="a &quot;b"><tr><td align="center">x</td></tr></table>',
		);
	});
	it("escapes stray angle brackets in text and drops comments and doctypes", () => {
		expect(clean("<!doctype html><!-- note --><p>1 < 2 <3</p><!--[if mso]><b>x</b><![endif]-->")).toBe("<p>1 &lt; 2 &lt;3</p>");
	});
	it("balances tags so author markup cannot swallow the footer", () => {
		expect(clean('<div style="display:none"><table><tr><td>x')).toBe('<div style="display:none"><table><tr><td>x</td></tr></table></div>');
		expect(clean("<b>x</i></b></div>")).toBe("<b>x</b>");
	});
	it("drops an unterminated tag the way browsers do", () => {
		expect(clean('<p>ok</p><img src="https://x.com/a.png" onerror="x"')).toBe("<p>ok</p>");
	});
	it("hoists <style> from a full document and keeps the body's own style", () => {
		const doc = sanitizeEmailHtml('<html><head><title>T</title><meta name="x"><link rel="stylesheet" href="https://x.com/a.css"><style>.a{color:red}</style></head><body bgcolor="#0b1220" style="font-family:Arial"><p class="a">Hi</p></body></html>');
		expect(doc.styles).toBe(".a{color:red}");
		expect(doc.body).toBe('<p class="a">Hi</p>');
		expect(doc.bodyStyle).toBe("background-color:#0b1220;font-family:Arial");
	});
	it("cannot be broken out of <style> or a style attribute", () => {
		const doc = sanitizeEmailHtml('<style>a{color:red}</style ><style>b{}</STYLE><p>x</p>');
		expect(doc.styles).toBe("a{color:red}\nb{}");
		expect(doc.body).toBe("<p>x</p>");
		expect(clean(`<p style="color:red&quot;><script>x</script>">t</p>`)).toBe('<p style="color:red&quot;&gt;script&gt;x/script&gt;">t</p>');
	});
});

describe("sanitizeCss", () => {
	it("keeps https urls and neutralizes everything that fetches or runs", () => {
		expect(sanitizeCss("background:url('https://x.com/a.png')")).toBe('background:url("https://x.com/a.png")');
		expect(sanitizeCss("background:url(javascript:alert(1))")).toBe("background:x(x:alert(1))");
		expect(sanitizeCss('@import "https://x.com/a.css"; a{b:c}')).toBe(" a{b:c}");
		expect(sanitizeCss("width:expression(alert(1));x:u\\72l(http://e)")).toBe("width:x(alert(1));x:u72l(http://e)");
		expect(sanitizeCss("a{}</style><script>")).toBe("a{}/style>script>");
		expect(sanitizeCss("behavior:url(x.htc);-moz-binding:url(x)")).toBe("x:none;x:none");
	});
});

describe("htmlToText", () => {
	it("keeps link targets, line breaks and list items", () => {
		expect(htmlToText('<h1>Hi&nbsp;Ana</h1><p>Read <a href="https://x.com/?a=1&amp;b=2">the guide</a>.<br>Thanks</p><ul><li>One</li><li>Two</li></ul>')).toBe(
			"Hi Ana\nRead the guide (https://x.com/?a=1&b=2).\nThanks\n\n- One\n- Two",
		);
	});
});

describe("lintEmailHtml", () => {
	const ids = (html: string) => lintEmailHtml(html).map((i) => i.id);
	it("flags what email clients remove or ignore", () => {
		expect(ids('<link rel="stylesheet" href="https://x.com/a.css"><script>x</script><div onclick="y" style="display:flex;position:absolute;color:var(--ink)"><form></form></div>')).toEqual(
			["script", "events", "link", "elements", "layout", "variables", "position"],
		);
		expect(ids('<a href="http://x.com">a</a><img src="https://x.com/a.png">')).toEqual(["urls", "alt", "width"]);
		expect(ids("<p style=\"font-family:'Inter'\">x</p><style>@font-face{font-family:Inter;src:url(https://x.com/i.woff2)}</style>")).toEqual(["webfonts", "fallback"]);
		expect(ids('<td style="background-image:url(https://x.com/a.png)">x</td>')).toEqual(["bgimage"]);
	});
	it("requires !important inside dark-mode rules", () => {
		expect(ids("<style>@media (prefers-color-scheme: dark){.a{color:#fff}}</style>")).toEqual(["dark"]);
		expect(ids("<style>@media (prefers-color-scheme: dark){.a{color:#fff !important;background:#000!important}}</style>")).toEqual([]);
	});
	it("ignores merge-field links and accepts a clean table layout", () => {
		expect(ids('<table role="presentation" width="100%"><tr><td style="font-family:Arial, sans-serif"><a href="{{link}}">Open</a> <img src="https://x.com/a.png" alt="" width="120"></td></tr></table>')).toEqual([]);
	});
});

describe("previewDocument", () => {
	const doc = "<!doctype html><html><head><style>@media (prefers-color-scheme: dark){a{color:#fff!important}}</style></head><body></body></html>";
	it("blocks remote loads except https images in every scheme", () => {
		for (const scheme of ["light", "dark", "forced"] as const) expect(previewDocument(doc, scheme)).toContain("default-src 'none'; img-src https:");
	});
	it("decides dark rules itself instead of following the viewer's OS theme", () => {
		expect(previewDocument(doc, "dark")).toContain("@media (min-width:0px)");
		expect(previewDocument(doc, "light")).toContain("@media (max-width:0px)");
		expect(previewDocument(doc, "forced")).toContain("@media (max-width:0px)");
		expect(previewDocument(doc, "forced")).toContain("filter:invert(1) hue-rotate(180deg)");
	});
});

describe("baseHtmlTemplate", () => {
	const template = baseHtmlTemplate("https://beta.ateneocode.org");
	it("passes its own checks and uses only profile fields", () => {
		expect(lintEmailHtml(template)).toEqual([]);
		expect(usedMergeTags(template).filter((tag) => !isMergeTag(tag))).toEqual([]);
		expect(findUnknownTags(template)).toEqual([]);
	});
	it("keeps its dark-mode rules and drops its comments when sanitized", () => {
		const doc = sanitizeEmailHtml(template);
		expect(doc.styles).toContain("@media (prefers-color-scheme: dark)");
		expect(doc.body).not.toContain("RULES FOR WHOEVER");
		expect(doc.body).toContain('<img class="logo-dark"');
		expect(doc.bodyStyle).toBe("");
	});
});
