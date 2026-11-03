import { describe, expect, it } from "vitest";
import { blocksForSending, inlineEmailCss, styleRules } from "./inline-css";

describe("styleRules", () => {
	it("orders plain rules by specificity and leaves at-rules, pseudo-states and Outlook dark rules to <style>", () => {
		const html = `<style>@charset "utf-8"; .btn{color:red} p{margin:0}/* c */ #hero .btn{color:blue} a:hover{color:x} td:first-child{padding:0}
			@media (max-width:600px){.btn{width:100%!important}} [data-ogsc] .btn{color:#fff} html,*{box-sizing:border-box}</style>`;
		expect(styleRules(html).map((r) => r.selector)).toEqual(["p", ".btn", "td:first-child", "#hero .btn"]);
	});
});

describe("inlineEmailCss", () => {
	it("inlines rules in cascade order with the author's style attribute last, and keeps the <style> block", async () => {
		const html = `<html><head><style>.btn{color:red;padding:4px} a.btn{color:green} @media (prefers-color-scheme: dark){.btn{color:#fff !important}}</style></head><body><a class="btn" href="https://x.com" style="font-weight:bold">Go</a><p class="btn">P</p></body></html>`;
		const out = await inlineEmailCss(html);
		expect(out).toContain('<a class="btn" href="https://x.com" style="color:red;padding:4px;color:green;font-weight:bold">Go</a>');
		expect(out).toContain('<p class="btn" style="color:red;padding:4px">P</p>');
		expect(out).toContain("@media (prefers-color-scheme: dark){.btn{color:#fff !important}}");
		expect(out).not.toContain("data-code-inline-original");
	});
	it("skips selectors the streaming parser cannot match and returns HTML without <style> unchanged", async () => {
		expect(await inlineEmailCss('<style>h1 + p{color:red} p{margin:0}</style><h1>A</h1><p>B</p>')).toContain('<p style="margin:0">B</p>');
		expect(await inlineEmailCss("<p>plain</p>")).toBe("<p>plain</p>");
	});
	it("only rewrites an HTML body", async () => {
		const text = [{ id: "t", type: "text" as const, props: { text: "Hi" } }];
		expect(await blocksForSending(text)).toBe(text);
		const [html] = await blocksForSending([{ id: "h", type: "html", props: { html: "<style>p{margin:0}</style><p>x</p>" } }]);
		expect(html).toEqual({ id: "h", type: "html", props: { html: '<style>p{margin:0}</style><p style="margin:0">x</p>' } });
	});
});
