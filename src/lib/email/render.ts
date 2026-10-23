import { htmlBodyOf, htmlToText, sanitizeEmailHtml } from "./html";
import { replaceTags, replaceTagsOneLine, type MergeValues } from "./merge";
import type { EmailBlock } from "./types";

export const EMAIL_COLORS = {
	navy: "#06192F",
	blue: "#0C315C",
	light: "#D7DFE9",
	ink: "#121315",
	muted: "#3D5266",
	pale: "#90B4CC",
	page: "#F5F5F6",
	line: "#AAAFB5",
} as const;

const HEADING_FONT = "Georgia, 'Times New Roman', serif";
const BODY_FONT = "Helvetica, Arial, sans-serif";

export type TagResolver = (tag: string) => string;

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Escaped value; a line break in a sheet cell becomes <br>. */
export const valueResolver =
	(values: MergeValues): TagResolver =>
	(tag) =>
		escapeHtml(values[tag] ?? "").replaceAll("\n", "<br>");

export const pillResolver: TagResolver = (tag) =>
	`<span data-merge-tag="${tag}" style="display:inline-block;padding:0 6px;border-radius:999px;background:${EMAIL_COLORS.light};color:${EMAIL_COLORS.blue};font-size:0.85em;font-family:${BODY_FONT};">${tag.replaceAll("_", " ")}</span>`;

/** Only https and mailto links survive; anything else becomes an inert "#". */
function safeUrl(url: string): string {
	return /^(https:\/\/|mailto:)/i.test(url) ? url : "#";
}
const safeAttr = (url: string) => escapeHtml(safeUrl(url));

/** Escape, apply inline marks, then merge last: resolver output is HTML-safe and must not be re-marked. */
function richText(text: string, resolve: TagResolver): string {
	const marked = escapeHtml(text)
		.replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g, `<a href="$2" style="color:${EMAIL_COLORS.blue};text-decoration:underline;">$1</a>`)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
	return replaceTags(marked, resolve);
}

function paragraphs(text: string, resolve: TagResolver): string {
	return text
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map(
			(part) =>
				`<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.ink};">${richText(part, resolve).replaceAll("\n", "<br>")}</p>`,
		)
		.join("");
}

const row = (inner: string, padding = "0 32px") => `<tr><td style="padding:${padding};">${inner}</td></tr>`;
const SPACER = { sm: 8, md: 24, lg: 48 } as const;

export function renderBlockHtml(block: EmailBlock, resolve: TagResolver, baseUrl: string): string {
	switch (block.type) {
		case "heading": {
			const size = block.props.level === 1 ? 28 : 21;
			const tag = block.props.level === 1 ? "h1" : "h2";
			return row(
				`<${tag} style="margin:0 0 12px;font-family:${HEADING_FONT};font-size:${size}px;line-height:1.25;font-weight:normal;color:${EMAIL_COLORS.navy};">${richText(block.props.text, resolve)}</${tag}>`,
			);
		}
		case "text":
			return row(paragraphs(block.props.text, resolve));
		case "button":
			return row(
				`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${EMAIL_COLORS.navy};"><a href="${safeAttr(block.props.href)}" style="display:inline-block;padding:12px 22px;font-family:${BODY_FONT};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${richText(block.props.label, resolve)}</a></td></tr></table>`,
			);
		case "image": {
			const img = `<img src="${safeAttr(block.props.src)}" alt="${escapeHtml(block.props.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;">`;
			const inner = block.props.href ? `<a href="${safeAttr(block.props.href)}">${img}</a>` : img;
			return row(`<div style="margin:0 0 16px;">${inner}</div>`);
		}
		case "divider":
			return row(`<div style="height:1px;background:${EMAIL_COLORS.light};margin:8px 0 24px;line-height:1px;font-size:1px;">&nbsp;</div>`);
		case "spacer":
			return row(`<div style="height:${SPACER[block.props.size]}px;line-height:1px;font-size:1px;">&nbsp;</div>`, "0");
		case "html":
			return row(sanitizeEmailHtml(replaceTags(block.props.html, resolve)).body);
		case "event": {
			const href = safeAttr(`${baseUrl}${block.props.path}`);
			return row(
				`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${EMAIL_COLORS.light};border-radius:10px;"><tr><td style="padding:16px 18px;font-family:${BODY_FONT};"><div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_COLORS.muted};">Event</div><div style="margin:4px 0 6px;font-family:${HEADING_FONT};font-size:20px;color:${EMAIL_COLORS.navy};">${escapeHtml(block.props.title)}</div><div style="font-size:15px;color:${EMAIL_COLORS.ink};">${escapeHtml(block.props.when)} &middot; ${escapeHtml(block.props.place)}</div><a href="${href}" style="display:inline-block;margin-top:10px;font-size:15px;font-weight:bold;color:${EMAIL_COLORS.blue};">View event</a></td></tr></table>`,
			);
		}
	}
}

export function renderHeaderHtml(logoUrl: string): string {
	return `<tr><td style="padding:28px 32px 20px;"><img src="${safeAttr(logoUrl)}" alt="CODE" width="120" style="display:block;width:120px;height:auto;border:0;"></td></tr>`;
}

export type FooterInput = {
	categoryName: string;
	required: boolean;
	archiveUrl: string | null;
	preferencesUrl: string;
	unsubscribeUrl: string | null;
	/** An outside recipient: no category line and no portal or unsubscribe links. */
	guest?: boolean;
};

const GUEST_FOOTER = "You received this email from CODE.";

const footerLink = (href: string, label: string) =>
	`<a href="${safeAttr(href)}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">${label}</a>`;

export function renderFooterHtml(footer: FooterInput): string {
	const style = `padding:24px 32px 32px;border-top:1px solid ${EMAIL_COLORS.light};font-family:${BODY_FONT};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.muted};`;
	if (footer.guest) return `<tr><td style="${style}">${GUEST_FOOTER}</td></tr>`;
	const links = [
		footer.archiveUrl ? footerLink(footer.archiveUrl, "Read in the portal") : null,
		footerLink(footer.preferencesUrl, "Email preferences"),
		!footer.required && footer.unsubscribeUrl ? footerLink(footer.unsubscribeUrl, `Unsubscribe from ${escapeHtml(footer.categoryName)}`) : null,
	].filter(Boolean);
	return `<tr><td style="${style}">You are getting this because you are a CODE member. Category: ${escapeHtml(footer.categoryName)}.<br>${links.join(" &middot; ")}</td></tr>`;
}

export type RenderInput = {
	subject: string;
	preheader: string;
	blocks: EmailBlock[];
	resolve: TagResolver;
	values: MergeValues;
	baseUrl: string;
	footer: FooterInput;
};

/** `framed` emails carry author HTML and CSS: show `html` in a sandboxed frame, never `bodyHtml` inline. */
export type RenderedEmail = { subject: string; preheader: string; html: string; bodyHtml: string; text: string; framed: boolean };

function blockText(block: EmailBlock, values: MergeValues, baseUrl: string): string {
	const merge = (text: string) => replaceTags(text, (tag) => values[tag] ?? "");
	const plain = (text: string) =>
		merge(text)
			.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*\n]+)\*/g, "$1");
	switch (block.type) {
		case "heading":
			return plain(block.props.text);
		case "text":
			return plain(block.props.text);
		case "button":
			return `${merge(block.props.label)}: ${block.props.href}`;
		case "image":
			return block.props.alt ? `[${block.props.alt}]` : "";
		case "divider":
			return "---";
		case "spacer":
			return "";
		case "html":
			return htmlToText(sanitizeEmailHtml(merge(block.props.html)).body);
		case "event":
			return `${block.props.title}\n${block.props.when} - ${block.props.place}\n${baseUrl}${block.props.path}`;
	}
}

// The footer sits on the author's background, so it brings its own dark-mode colors (Apple Mail, then Outlook.com).
const FRAMED_FOOTER_CSS =
	"@media (prefers-color-scheme: dark){.code-footer td{color:#AAAFB5 !important;border-color:#3D5266 !important}.code-footer a{color:#D7DFE9 !important}}[data-ogsc] .code-footer td{color:#AAAFB5 !important}[data-ogsc] .code-footer a{color:#D7DFE9 !important}";
const preheaderSpan = (preheader: string) => `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>`;

/** Author HTML: merged (values escaped), then sanitized, with the required footer appended outside the author's markup. */
function renderFramed(input: RenderInput, source: string, subject: string, preheader: string) {
	const doc = sanitizeEmailHtml(replaceTags(source, input.resolve));
	const footer = `<table role="presentation" class="code-footer" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">${renderFooterHtml(input.footer)}</table>`;
	const bodyHtml = `<div${doc.bodyStyle ? ` style="${escapeHtml(doc.bodyStyle)}"` : ""}>${doc.body}${footer}</div>`;
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title><style>${doc.styles}\n${FRAMED_FOOTER_CSS}</style></head><body style="margin:0;padding:0;">${preheaderSpan(preheader)}${bodyHtml}</body></html>`;
	return { html, bodyHtml, content: doc.body };
}

export function renderEmail(input: RenderInput): RenderedEmail {
	const subject = replaceTagsOneLine(input.subject, input.values);
	const preheader = replaceTagsOneLine(input.preheader, input.values);
	const source = htmlBodyOf(input.blocks);
	if (source !== null) {
		const { html, bodyHtml, content } = renderFramed(input, source, subject, preheader);
		return { subject, preheader, html, bodyHtml, text: [htmlToText(content), "--", footerTextOf(input.footer)].join("\n\n"), framed: true };
	}
	const logoUrl = `${input.baseUrl}/code-logo-full-navy.png`;
	const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:12px;">${renderHeaderHtml(logoUrl)}${input.blocks
		.map((block) => renderBlockHtml(block, input.resolve, input.baseUrl))
		.join("")}${renderFooterHtml(input.footer)}</table>`;
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:${EMAIL_COLORS.page};">${preheaderSpan(preheader)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.page};"><tr><td style="padding:24px 12px;">${bodyHtml}</td></tr></table></body></html>`;
	const text = [...input.blocks.map((block) => blockText(block, input.values, input.baseUrl)).filter(Boolean), "--", footerTextOf(input.footer)].join("\n\n");
	return { subject, preheader, html, bodyHtml, text, framed: false };
}

function footerTextOf(footer: FooterInput): string {
	return footer.guest
		? GUEST_FOOTER
		: [
				`Category: ${footer.categoryName}`,
				footer.archiveUrl ? `Read in the portal: ${footer.archiveUrl}` : null,
				`Email preferences: ${footer.preferencesUrl}`,
				!footer.required && footer.unsubscribeUrl ? `Unsubscribe: ${footer.unsubscribeUrl}` : null,
			]
				.filter(Boolean)
				.join("\n");
}

/** Block content as an editable HTML document, fields kept as {{tags}}, for switching an email to the HTML body. */
export function blocksToHtml(blocks: EmailBlock[], baseUrl: string): string {
	const keep: TagResolver = (tag) => `{{${tag}}}`;
	const rows = [renderHeaderHtml(`${baseUrl}/code-logo-full-navy.png`), ...blocks.map((block) => renderBlockHtml(block, keep, baseUrl))].join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.page};"><tr><td style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border-radius:12px;">
${rows}
</table>
</td></tr></table>
</body>
</html>
`;
}
