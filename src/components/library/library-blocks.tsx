/* eslint-disable @next/next/no-img-element -- images come from our own authenticated /api/uploads route, which next/image's optimizer cannot read. */
import Link from "next/link";
import { ExternalLink, Info, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LibraryBlock } from "@/lib/library/blocks";
import { KIND_LABELS } from "@/lib/library/taxonomy";
import type { LibraryCard } from "@/db/repositories/library";
import { cn } from "@/lib/utils";
import { InlineText } from "./inline-text";

// Prose wraps at word breaks but still lets one very long word break, so phones never scroll sideways.
const PROSE = "min-w-0 [overflow-wrap:anywhere]";
const HTTPS_URL = /^https:\/\/\S+$/i;

/** A block with nothing to show. The reader skips it and the editor shows a hint instead. */
export function isBlankBlock(block: LibraryBlock): boolean {
	switch (block.type) {
		case "heading":
		case "text":
		case "callout":
		case "quote":
			return !block.props.text.trim();
		case "list":
			return block.props.items.every((item) => !item.trim());
		case "code":
			return !block.props.code.trim();
		default:
			return false;
	}
}

const paragraphs = (text: string) =>
	text
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean);

function Paragraphs({ text, className }: { text: string; className?: string }) {
	return (
		<>
			{paragraphs(text).map((part, index) => (
				<p key={index} className={cn(PROSE, "whitespace-pre-line leading-7", className)}>
					<InlineText text={part} />
				</p>
			))}
		</>
	);
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function ItemEmbed({ card }: { card: LibraryCard | null | undefined }) {
	if (!card) {
		return <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Not available</div>;
	}
	const authors = card.authorsJson.map((author) => author.name).join(", ");
	return (
		<Link
			href={`/portal/library/${card.id}`}
			className="block min-w-0 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="secondary">{KIND_LABELS[card.kind]}</Badge>
				{card.year ? <span className="text-xs text-muted-foreground">{card.year}</span> : null}
			</div>
			<div className="mt-2 min-w-0 break-all font-medium">{card.title}</div>
			{card.dek ? <div className={cn(PROSE, "mt-1 line-clamp-2 text-sm text-muted-foreground")}>{card.dek}</div> : null}
			{authors ? <div className="mt-1 min-w-0 break-all text-xs text-muted-foreground">{authors}</div> : null}
		</Link>
	);
}

function LinkCard({ url, title, description }: { url: string; title: string; description?: string }) {
	const body = (
		<>
			<ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
			<div className="min-w-0">
				<div className="min-w-0 break-all font-medium">{title.trim() || hostOf(url)}</div>
				{description?.trim() ? <div className={cn(PROSE, "mt-1 line-clamp-3 text-sm text-muted-foreground")}>{description}</div> : null}
				<div className="mt-1 min-w-0 break-all text-xs text-muted-foreground">{hostOf(url)}</div>
			</div>
		</>
	);
	const box = "flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4";
	// Stored data is validated on save; this only stops a corrupt row from becoming a javascript: link.
	if (!HTTPS_URL.test(url)) return <div className={box}>{body}</div>;
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(box, "transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
		>
			{body}
		</a>
	);
}

/** One block as our own JSX. The editor canvas reuses this so what you edit is what readers get. */
export function LibraryBlockView({ block, embeds }: { block: LibraryBlock; embeds: Map<string, LibraryCard | null> }) {
	if (isBlankBlock(block)) return null;

	switch (block.type) {
		case "heading": {
			const text = <InlineText text={block.props.text} />;
			return block.props.level === 2 ? (
				<h2 className={cn(PROSE, "pt-3 text-2xl font-semibold tracking-tight")}>{text}</h2>
			) : (
				<h3 className={cn(PROSE, "pt-1 text-lg font-semibold tracking-tight")}>{text}</h3>
			);
		}
		case "text":
			return (
				<div className="space-y-4">
					<Paragraphs text={block.props.text} />
				</div>
			);
		case "list": {
			const items = block.props.items.filter((item) => item.trim());
			const List = block.props.ordered ? "ol" : "ul";
			return (
				<List className={cn("space-y-1.5 pl-6 leading-7", block.props.ordered ? "list-decimal" : "list-disc")}>
					{items.map((item, index) => (
						<li key={index} className={PROSE}>
							<InlineText text={item} />
						</li>
					))}
				</List>
			);
		}
		case "quote":
			return (
				<figure className="border-l-4 border-accent pl-4">
					<blockquote className="space-y-3 italic">
						<Paragraphs text={block.props.text} />
					</blockquote>
					{block.props.cite?.trim() ? (
						<figcaption className={cn(PROSE, "mt-2 text-sm text-muted-foreground")}>
							<InlineText text={block.props.cite} />
						</figcaption>
					) : null}
				</figure>
			);
		case "callout": {
			const tip = block.props.tone === "tip";
			const Icon = tip ? Lightbulb : Info;
			return (
				<aside className={cn("flex min-w-0 gap-3 rounded-xl border p-4", tip ? "border-accent bg-accent/10" : "border-border bg-secondary")}>
					<Icon className="mt-1 size-4 shrink-0" aria-hidden />
					<div className="min-w-0 flex-1 space-y-2">
						<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tip ? "Tip" : "Note"}</div>
						<Paragraphs text={block.props.text} />
					</div>
				</aside>
			);
		}
		case "code":
			return (
				<div className="min-w-0">
					{block.props.language?.trim() ? <div className="mb-1 min-w-0 break-all text-xs font-medium text-muted-foreground">{block.props.language}</div> : null}
					<pre
						tabIndex={0}
						aria-label={block.props.language?.trim() ? `${block.props.language} code` : "Code"}
						className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-sm leading-6"
					>
						<code>{block.props.code}</code>
					</pre>
				</div>
			);
		case "image":
			return (
				<figure className="min-w-0">
					<img
						src={`/api/uploads/${encodeURIComponent(block.props.key)}`}
						alt={block.props.alt}
						loading="lazy"
						decoding="async"
						className="mx-auto h-auto max-h-[80vh] max-w-full rounded-lg border border-border"
					/>
					{block.props.caption?.trim() ? (
						<figcaption className="mt-2 min-w-0 break-all text-center text-sm text-muted-foreground">{block.props.caption}</figcaption>
					) : null}
				</figure>
			);
		case "divider":
			return <hr className="border-border" />;
		case "item":
			return <ItemEmbed card={embeds.get(block.props.itemId)} />;
		case "link":
			return <LinkCard url={block.props.url} title={block.props.title} description={block.props.description} />;
	}
}

/** A page's blocks for reading. `embeds` maps an embedded item's id to its card, or null when the reader cannot see it. */
export function LibraryBlocks({ blocks, embeds }: { blocks: LibraryBlock[]; embeds: Map<string, LibraryCard | null> }) {
	return (
		<div className="min-w-0 space-y-5">
			{blocks.map((block) => (
				<LibraryBlockView key={block.id} block={block} embeds={embeds} />
			))}
		</div>
	);
}
