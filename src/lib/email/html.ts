import type { EmailBlock } from "./types";

/** Gmail clips messages over about 102 KB; this leaves room for the footer and wrapper. */
export const HTML_MAX = 95_000;

/** The HTML source when an email's body is one HTML block, else null. */
export const htmlBodyOf = (blocks: EmailBlock[]): string | null => (blocks.length === 1 && blocks[0].type === "html" ? blocks[0].props.html : null);

const escapeAttr = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const NAMED: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
	mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", bull: "•",
};

/** Numeric references with or without a semicolon (as browsers decode them), named ones only with it. */
export function decodeEntities(value: string): string {
	return value.replace(/&(?:#(\d{1,8});?|#x([0-9a-f]{1,7});?|([a-z]{2,8});)/gi, (whole, dec?: string, hex?: string, name?: string) => {
		if (dec || hex) {
			const cp = dec ? Number(dec) : parseInt(hex!, 16);
			return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : "�";
		}
		return NAMED[name!.toLowerCase()] ?? whole;
	});
}

/** https everywhere; links may also use mailto:, tel: or an in-page #anchor. Anything else is refused. */
function safeUrl(raw: string, attr: string): string | null {
	const url = raw.trim();
	if (/[\u0000-\u001f\u007f]/.test(url)) return null;
	if (/^https:\/\/\S/i.test(url)) return url;
	if (attr === "href" && (/^mailto:\S/i.test(url) || /^tel:[+\d(]/i.test(url) || /^#[\w-]*$/.test(url))) return url;
	return null;
}

/** Neutralizes CSS that can fetch or run something: imports, non-https url(), expressions, bindings, escapes. */
export function sanitizeCss(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
		.replace(/[\\<]/g, "")
		.replace(/@import[^;]*;?/gi, "")
		.replace(/url\(\s*(['"]?)([^'"()]*)\1\s*\)/gi, (_, _q, url: string) => (/^https:\/\/\S+$/i.test(url.trim()) ? `url("${url.trim()}")` : "none"))
		.replace(/url\((?!"https:\/\/)/gi, "x(")
		.replace(/(expression|image-set|-webkit-image-set)\s*\(/gi, "x(")
		.replace(/(javascript|vbscript)\s*:/gi, "x:")
		.replace(/(behavior|-moz-binding)\s*:/gi, "x:");
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
const KEEP = new Set([
	"a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
	"dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i",
	"img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "sup",
	"table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
]);
/** Raw-text elements: their content is never markup. Only <style> is kept. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
/** Removed together with everything inside them. Other unknown tags (html, body, form, button, picture) unwrap. */
const DROP = new Set(["object", "applet", "frameset", "template", "svg", "math", "video", "audio", "canvas", "select", "datalist", "map"]);
const ATTRS = new Set([
	"style", "class", "id", "align", "valign", "width", "height", "bgcolor", "border", "dir", "lang", "title", "role", "colspan", "rowspan",
	"cellpadding", "cellspacing", "color", "face", "size", "alt", "nowrap", "span", "start", "datetime",
]);
const URL_ATTRS: Record<string, Set<string>> = { href: new Set(["a"]), src: new Set(["img"]), background: new Set(["table", "td", "th", "tr"]) };

type Tag = { closing: boolean; name: string; attrs: [string, string][]; end: number };
const TAG_OPEN = /<(\/?)([a-zA-Z][^\s/>]*)/y;

/** Tokenizes one tag the way the HTML spec does; null when `<` does not start a tag. An unterminated tag runs to the end. */
function readTag(html: string, start: number): Tag | null {
	TAG_OPEN.lastIndex = start;
	const m = TAG_OPEN.exec(html);
	if (!m) return null;
	const attrs: [string, string][] = [];
	let i = start + m[0].length;
	while (i < html.length) {
		const ch = html[i];
		if (ch === ">") return { closing: m[1] === "/", name: m[2].toLowerCase(), attrs, end: i + 1 };
		if (/[\s/]/.test(ch)) { i++; continue; }
		let j = i + 1;
		while (j < html.length && !/[\s/>=]/.test(html[j])) j++;
		const name = html.slice(i, j).toLowerCase();
		i = j;
		while (i < html.length && /\s/.test(html[i])) i++;
		let value = "";
		if (html[i] === "=") {
			i++;
			while (i < html.length && /\s/.test(html[i])) i++;
			const quote = html[i];
			if (quote === '"' || quote === "'") {
				const close = html.indexOf(quote, i + 1);
				value = html.slice(i + 1, close < 0 ? html.length : close);
				i = close < 0 ? html.length : close + 1;
			} else {
				let k = i;
				while (k < html.length && !/[\s>]/.test(html[k])) k++;
				value = html.slice(i, k);
				i = k;
			}
		}
		attrs.push([name, value]);
	}
	return { closing: m[1] === "/", name: m[2].toLowerCase(), attrs, end: html.length };
}

function cleanAttrs(tag: string, attrs: [string, string][]): string {
	let out = "";
	const seen = new Set<string>();
	for (const [name, raw] of attrs) {
		if (seen.has(name)) continue; // browsers keep the first of a repeated attribute
		seen.add(name);
		let value: string | null = decodeEntities(raw);
		if (URL_ATTRS[name]) {
			if (!URL_ATTRS[name].has(tag)) continue;
			value = safeUrl(value, name) ?? (name === "href" ? "#" : null);
		} else if (name === "style") value = sanitizeCss(value);
		else if (name === "target") value = tag === "a" && value.trim().toLowerCase() === "_blank" ? "_blank" : null;
		else if (name === "type") value = ["ol", "ul", "li"].includes(tag) ? value : null;
		else if (!ATTRS.has(name) && !/^aria-[a-z-]+$/.test(name)) value = null;
		if (value !== null) out += ` ${name}="${escapeAttr(value)}"`;
	}
	return out;
}

export type SanitizedHtml = {
	/** Every <style> block, cleaned and joined, for the document head. */
	styles: string;
	/** Body content with only allowed tags and attributes, tags balanced. */
	body: string;
	/** The <body> element's own style and bgcolor, for a wrapper. */
	bodyStyle: string;
};

/**
 * Allowlist sanitizer for author HTML. Pure TypeScript so the browser preview and the Worker send share one code path.
 * Output is re-serialized from tokens: text keeps no raw `<`, attribute values are decoded, checked and re-escaped.
 */
export function sanitizeEmailHtml(html: string): SanitizedHtml {
	const styles: string[] = [];
	const stack: string[] = [];
	let body = "";
	let bodyStyle = "";
	let skip: { name: string; depth: number } | null = null;
	let i = 0;
	const text = (value: string) => {
		if (!skip) body += value.replaceAll("<", "&lt;");
	};
	while (i < html.length) {
		const lt = html.indexOf("<", i);
		if (lt < 0) { text(html.slice(i)); break; }
		text(html.slice(i, lt));
		i = lt;
		if (html.startsWith("<!--", i)) {
			const close = html.indexOf("-->", i + 4);
			i = close < 0 ? html.length : close + 3;
			continue;
		}
		if (html[i + 1] === "!" || html[i + 1] === "?") {
			const close = html.indexOf(">", i);
			i = close < 0 ? html.length : close + 1;
			continue;
		}
		const tag = readTag(html, i);
		if (!tag) { text("<"); i++; continue; }
		i = tag.end;
		if (tag.end === html.length && html[html.length - 1] !== ">") break; // unterminated tag: browsers drop it
		const { name, closing } = tag;
		if (skip) {
			if (name === skip.name && !VOID.has(name)) skip.depth += closing ? -1 : 1;
			if (skip.depth === 0) skip = null;
			continue;
		}
		if (!closing && RAW_TEXT.has(name)) {
			const end = name === "plaintext" ? null : new RegExp(`</${name}[\\s/>]`, "ig");
			if (end) end.lastIndex = i;
			const match = end?.exec(html);
			const content = html.slice(i, match ? match.index : html.length);
			if (name === "style") styles.push(sanitizeCss(content).trim());
			const close = match ? html.indexOf(">", match.index) : -1;
			i = close < 0 ? html.length : close + 1;
			continue;
		}
		if (DROP.has(name)) {
			if (!closing) skip = { name, depth: 1 };
			continue;
		}
		if (name === "body" && !closing) {
			const attrs = Object.fromEntries(tag.attrs);
			const color = decodeEntities(attrs.bgcolor ?? "").trim();
			bodyStyle = [/^#?[\w]{1,20}$/.test(color) ? `background-color:${color}` : "", sanitizeCss(decodeEntities(attrs.style ?? "")).trim()].filter(Boolean).join(";");
			continue;
		}
		if (!KEEP.has(name)) continue;
		if (closing) {
			const at = stack.lastIndexOf(name);
			if (at < 0) continue;
			while (stack.length > at) body += `</${stack.pop()}>`;
			continue;
		}
		body += `<${name}${cleanAttrs(name, tag.attrs)}>`;
		if (!VOID.has(name)) stack.push(name);
	}
	while (stack.length) body += `</${stack.pop()}>`;
	return { styles: styles.filter(Boolean).join("\n"), body: body.trim(), bodyStyle };
}

/** Plain-text alternative from sanitized body HTML. */
export function htmlToText(html: string): string {
	const linked = html.replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
		const label = inner.replace(/<[^>]+>/g, "").trim();
		const url = decodeEntities(href);
		return url && url !== "#" && !label.includes(url) ? `${label} (${url})` : label;
	});
	return decodeEntities(
		linked
			.replace(/<br\b[^>]*>/gi, "\n")
			.replace(/<li\b[^>]*>/gi, "\n- ")
			.replace(/<\/(p|div|tr|h[1-6]|table|blockquote|section|header|footer|ul|ol)>/gi, "\n")
			.replace(/<\/t[dh]>/gi, " ")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/[ \t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export type HtmlIssue = { id: string; level: "removed" | "unsupported" | "tip"; message: string };

const GENERIC_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i;

function darkRulesWithoutImportant(html: string): boolean {
	const media = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
	for (let m = media.exec(html); m; m = media.exec(html)) {
		let depth = 1;
		let j = m.index + m[0].length;
		for (; j < html.length && depth > 0; j++) depth += html[j] === "{" ? 1 : html[j] === "}" ? -1 : 0;
		const block = html.slice(m.index + m[0].length, j - 1);
		for (const decl of block.matchAll(/\{([^{}]*)\}/g)) if (decl[1].split(";").some((d) => d.includes(":") && !/!important/i.test(d))) return true;
	}
	return false;
}

/** What real inboxes will remove or ignore. Runs on the author's HTML, before sanitizing. */
export function lintEmailHtml(source: string): HtmlIssue[] {
	// Comments are removed on send, so what they mention never reaches an inbox.
	const html = source.replace(/<!--(?!\[if)[\s\S]*?(-->|$)/g, "");
	const issues: HtmlIssue[] = [];
	const add = (id: string, level: HtmlIssue["level"], message: string) => issues.push({ id, level, message });
	if (/<script\b/i.test(html)) add("script", "removed", "Scripts are removed. No email client runs them.");
	if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) add("events", "removed", "Event handlers such as onclick are removed.");
	if (/<link\b[^>]*stylesheet/i.test(html)) add("link", "removed", "External stylesheets are removed. Put the CSS in a <style> block or in style attributes.");
	if (/@import\b/i.test(html)) add("import", "removed", "@import is removed. Copy the CSS into the <style> block.");
	const elements = [...new Set([...html.matchAll(/<(form|input|button|select|textarea|iframe|object|embed|video|audio|svg|canvas)\b/gi)].map((m) => m[1].toLowerCase()))];
	if (elements.length) add("elements", "removed", `These elements are removed: ${elements.map((e) => `<${e}>`).join(", ")}. Forms and media do not work in email; link to a page instead.`);
	const urls = [...html.matchAll(/\s(href|src|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
		.map((m) => ({ attr: m[1].toLowerCase(), value: decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") }))
		.filter((u) => !u.value.includes("{{") && !safeUrl(u.value, u.attr));
	if (urls.length) add("urls", "removed", `${urls.length} ${urls.length === 1 ? "link or image uses" : "links or images use"} an address that is not https:// (or mailto: for links), for example "${urls[0].value.slice(0, 60)}". Those are removed when sent.`);
	if (/<!--\[if/i.test(html)) add("conditional", "removed", "Comments are removed when sent, including Outlook conditional comments.");
	if (/display\s*:\s*(inline-)?(flex|grid)\b|grid-template/i.test(html)) add("layout", "unsupported", "Flexbox and grid do not work in Outlook for Windows and many Gmail views. Use tables for layout.");
	if (/var\(\s*--|(^|[;{\s"])--[a-z0-9-]+\s*:/i.test(html)) add("variables", "unsupported", "CSS variables do not work in Gmail or Outlook. Write the values directly.");
	if (/position\s*:\s*(absolute|fixed|relative|sticky)/i.test(html)) add("position", "unsupported", "position is stripped by Gmail and ignored by Outlook. Use table cells and padding instead.");
	if (/@font-face|fonts\.googleapis\.com|use\.typekit/i.test(html)) add("webfonts", "unsupported", "Web fonts only load in Apple Mail and a few phone apps. Gmail and Outlook show the fallback font.");
	const noFallback = [...new Set([...html.replace(/@font-face\s*\{[^}]*\}/gi, "").matchAll(/font-family\s*:\s*([^;}"]+)/gi)].map((m) => decodeEntities(m[1]).trim()).filter((v) => !GENERIC_FONTS.test(v.split(",").at(-1)!.trim().replace(/^['"]|['"]$/g, ""))))];
	if (noFallback.length) add("fallback", "unsupported", `Add a generic fallback such as Arial, sans-serif to: ${noFallback.slice(0, 3).join("; ")}.`);
	if (/background-image\s*:|background\s*:[^;"]*url\(|\sbackground\s*=/i.test(html)) add("bgimage", "unsupported", "Outlook for Windows does not show background images. Set a background color as well so text stays readable.");
	if (darkRulesWithoutImportant(html)) add("dark", "unsupported", "Dark mode rules need !important. Styles are inlined when sent, and inline styles win over rules without it.");
	const bytes = new TextEncoder().encode(html).length;
	if (bytes > 80_000) add("size", "tip", `This HTML is ${Math.round(bytes / 1000)} KB. Gmail hides everything past about 102 KB behind "View entire message".`);
	const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
	const noAlt = imgs.filter((tag) => !/\salt\s*=/i.test(tag)).length;
	if (noAlt) add("alt", "tip", `${noAlt} ${noAlt === 1 ? "image has" : "images have"} no alt text. Many inboxes block images until the reader allows them.`);
	if (imgs.some((tag) => !/\swidth\s*=/i.test(tag))) add("width", "tip", "Give every image a width attribute. Outlook for Windows otherwise shows it at full size.");
	if (/box-shadow/i.test(html)) add("shadow", "tip", "Outlook for Windows and Gmail drop shadows. Use a border if the edge matters.");
	return issues;
}

export type PreviewScheme = "light" | "dark" | "forced";

/**
 * Prepares a rendered email for a sandboxed preview frame. The CSP blocks every fetch except https images, so web
 * fonts fall back as they do in Gmail and Outlook. "dark" turns on the author's prefers-color-scheme rules as Apple
 * Mail does; "forced" inverts colors (but not images) as the Gmail app and Outlook do when they ignore those rules.
 */
export function previewDocument(html: string, scheme: PreviewScheme): string {
	const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'">`;
	// The frame would otherwise follow the admin's own OS theme. Rewrite the queries so each scheme decides them.
	const dark = scheme === "dark";
	const doc = html
		.replace(/prefers-color-scheme\s*:\s*dark/gi, dark ? "min-width:0px" : "max-width:0px")
		.replace(/prefers-color-scheme\s*:\s*light/gi, dark ? "max-width:0px" : "min-width:0px");
	const extra = dark
		? "<style>:root{color-scheme:dark}</style>"
		: scheme === "forced"
			? "<style>:root{color-scheme:light}html{background:#fff;filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}</style>"
			: "<style>:root{color-scheme:light}</style>";
	return doc.replace(/<head>/i, `<head>${csp}${extra}`);
}
