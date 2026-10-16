/**
 * Tiny inline markup for library text: **bold**, *italic*, [label](https://… or mailto:…).
 * Parsed to a tree, never to HTML, so renderers build elements and nothing is injected.
 * Anything malformed (unclosed marker, unsafe link) stays literal text.
 */
export type InlineNode =
	| { type: "text"; text: string }
	| { type: "bold"; children: InlineNode[] }
	| { type: "italic"; children: InlineNode[] }
	| { type: "link"; href: string; children: InlineNode[] };

const SAFE_HREF = /^(?:https:\/\/|mailto:)\S+$/i;
// Sticky, so it only matches at lastIndex and the source is never sliced.
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/y;

/** A marker pair only counts when it hugs its content, so "2 * 3 * 4" stays literal. */
const hugs = (inner: string) => inner.length > 0 && inner.trim() === inner;

export function parseInline(text: string): InlineNode[] {
	const nodes: InlineNode[] = [];
	let literal = "";
	const flush = () => {
		if (literal) nodes.push({ type: "text", text: literal });
		literal = "";
	};

	let i = 0;
	while (i < text.length) {
		const char = text[i];

		if (char === "*") {
			const bold = text.startsWith("**", i);
			const marker = bold ? "**" : "*";
			const end = text.indexOf(marker, i + marker.length);
			const inner = end === -1 ? "" : text.slice(i + marker.length, end);
			if (hugs(inner)) {
				flush();
				nodes.push({ type: bold ? "bold" : "italic", children: parseInline(inner) });
				i = end + marker.length;
			} else {
				// Not a pair: keep the whole marker literal so "**" is never re-read as "*".
				literal += marker;
				i += marker.length;
			}
			continue;
		}

		if (char === "[") {
			LINK.lastIndex = i;
			const match = LINK.exec(text);
			if (match && SAFE_HREF.test(match[2])) {
				flush();
				nodes.push({ type: "link", href: match[2], children: parseInline(match[1]) });
				i += match[0].length;
				continue;
			}
		}

		literal += char;
		i += 1;
	}

	flush();
	return nodes;
}

function nodesToPlainText(nodes: InlineNode[]): string {
	return nodes.map((node) => (node.type === "text" ? node.text : nodesToPlainText(node.children))).join("");
}

/** The text with markup removed: link labels are kept, URLs are dropped. */
export function inlineToPlainText(text: string): string {
	return nodesToPlainText(parseInline(text));
}
