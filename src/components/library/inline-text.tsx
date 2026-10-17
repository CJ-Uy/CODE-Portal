import type { ReactNode } from "react";
import { parseInline, type InlineNode } from "@/lib/library/inline";

function renderNodes(nodes: InlineNode[]): ReactNode[] {
	return nodes.map((node, index) => {
		switch (node.type) {
			case "text":
				return node.text;
			case "bold":
				return <strong key={index}>{renderNodes(node.children)}</strong>;
			case "italic":
				return <em key={index}>{renderNodes(node.children)}</em>;
			case "link":
				// parseInline only emits https: and mailto: hrefs.
				return (
					<a
						key={index}
						href={node.href}
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-foreground underline decoration-accent underline-offset-2 transition-colors hover:text-accent"
					>
						{renderNodes(node.children)}
					</a>
				);
		}
	});
}

/** Library inline markup (bold, italic, links) as React elements. Never HTML. */
export function InlineText({ text }: { text: string }) {
	return <>{renderNodes(parseInline(text))}</>;
}
