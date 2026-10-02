const DROP = new Set([
	"script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select",
	"option", "head", "title", "meta", "link", "base", "svg", "math", "noscript", "template", "video", "audio", "source", "picture",
]);
const KEEP = new Set([
	"a", "b", "strong", "i", "em", "u", "s", "p", "br", "div", "span", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3",
	"h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "hr", "small", "sub", "sup", "center", "font",
]);
const ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href", "title"]),
	td: new Set(["colspan", "rowspan", "align"]),
	th: new Set(["colspan", "rowspan", "align"]),
};

/** Inbound HTML is untrusted. The result is also rendered inside a sandboxed iframe. */
export async function sanitizeEmailHtml(html: string): Promise<string> {
	const rewriter = new HTMLRewriter()
		.on("*", {
			element(element) {
				const tag = element.tagName.toLowerCase();
				if (DROP.has(tag)) {
					element.remove();
					return;
				}
				if (tag === "img") {
					const alt = element.getAttribute("alt")?.trim();
					element.replace(alt ? `[image: ${alt}]` : "[image]", { html: false });
					return;
				}
				if (!KEEP.has(tag)) {
					element.removeAndKeepContent();
					return;
				}
				const allowed = ATTRIBUTES[tag];
				// tsconfig's DOM lib types `attributes` as NamedNodeMap; at runtime it is the Workers [name, value] iterator.
				for (const [name] of [...(element.attributes as unknown as Iterable<[string, string]>)]) if (!allowed?.has(name.toLowerCase())) element.removeAttribute(name);
				if (tag === "a") {
					const href = element.getAttribute("href")?.trim() ?? "";
					if (/^(https?:|mailto:)/i.test(href)) {
						element.setAttribute("target", "_blank");
						element.setAttribute("rel", "noopener noreferrer nofollow");
					} else {
						element.removeAttribute("href");
					}
				}
			},
		})
		.onDocument({
			comments(comment) {
				comment.remove();
			},
			doctype() {},
		});
	return (await rewriter.transform(new Response(html)).text()).trim();
}
