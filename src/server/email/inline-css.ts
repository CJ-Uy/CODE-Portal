import { htmlBodyOf } from "@/lib/email/html";
import type { EmailBlock } from "@/lib/email/types";

// Pseudo-classes HTMLRewriter can match while streaming. Anything else (:hover, ::before, :last-child) stays in <style> only.
const STREAMABLE_PSEUDO = /:(first-child|first-of-type|nth-child\([^)]*\)|nth-of-type\([^)]*\)|not\([^)]*\))/g;
const ORIGINAL = "data-code-inline-original";

function specificity(selector: string): number {
	const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
	const classes = selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0;
	const types = selector.replace(/\[[^\]]*\]|\([^)]*\)/g, "").match(/(^|[\s>])[a-zA-Z][\w-]*/g)?.length ?? 0;
	return ids * 10_000 + classes * 100 + types;
}

/** Top-level style rules from every <style> block. At-rules (@media, @font-face) are skipped: they stay in <style>. */
export function styleRules(html: string): { selector: string; declarations: string; specificity: number; order: number }[] {
	const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	let i = 0;
	while (i < css.length) {
		const open = css.indexOf("{", i);
		if (open < 0) break;
		let depth = 1;
		let end = open + 1;
		for (; end < css.length && depth > 0; end++) depth += css[end] === "{" ? 1 : css[end] === "}" ? -1 : 0;
		const prelude = css.slice(i, open).replace(/^[\s;]*(@[^;{]*;\s*)*/, "").trim();
		const body = css.slice(open + 1, end - 1);
		i = end;
		if (!prelude || prelude.startsWith("@") || body.includes("{")) continue;
		const declarations = body.replace(/\s+/g, " ").trim().replace(/;$/, "");
		if (!declarations) continue;
		for (const selector of prelude.split(",").map((s) => s.trim())) {
			const bare = selector.replace(STREAMABLE_PSEUDO, "");
			if (!selector || bare.includes(":") || /^(html|:root|\*)$/i.test(selector) || /data-og/i.test(selector)) continue;
			rules.push({ selector, declarations, specificity: specificity(selector), order: rules.length });
		}
	}
	return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

/**
 * Copies <style> rules into style attributes so clients that drop <style> (Gmail with non-Google accounts, some
 * Outlook builds) still get them. The <style> block stays for clients that support it, so media queries and dark-mode
 * rules keep working. Existing style attributes win, as they would in a browser. On any failure the HTML is returned as is.
 */
export async function inlineEmailCss(html: string): Promise<string> {
	const rules = styleRules(html);
	if (rules.length === 0) return html;
	try {
		// Handlers run in registration order for each element: stash the author's inline style, add rules from least to most specific, then restore it last.
		const rewriter = new HTMLRewriter().on("*", {
			element(el) {
				const own = el.getAttribute("style");
				if (own === null) return;
				el.setAttribute(ORIGINAL, own);
				el.removeAttribute("style");
			},
		});
		for (const rule of rules) {
			try {
				rewriter.on(rule.selector, {
					element(el) {
						const current = el.getAttribute("style");
						el.setAttribute("style", current ? `${current};${rule.declarations}` : rule.declarations);
					},
				});
			} catch {
				// A selector HTMLRewriter cannot stream (a + b, a ~ b) is left to the <style> block.
			}
		}
		rewriter.on("*", {
			element(el) {
				const own = el.getAttribute(ORIGINAL);
				if (own === null) return;
				const current = el.getAttribute("style");
				el.setAttribute("style", current ? `${current};${own}` : own);
				el.removeAttribute(ORIGINAL);
			},
		});
		return await rewriter.transform(new Response(html)).text();
	} catch (error) {
		console.error("email: CSS inlining failed, sending with <style> only", error);
		return html;
	}
}

/** The blocks to send: an HTML body gets its CSS inlined first. Merge and sanitizing still run per recipient. */
export async function blocksForSending(blocks: EmailBlock[]): Promise<EmailBlock[]> {
	const source = htmlBodyOf(blocks);
	if (source === null) return blocks;
	return [{ id: blocks[0].id, type: "html", props: { html: await inlineEmailCss(source) } }];
}
