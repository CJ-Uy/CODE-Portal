import Link from "next/link";
import { Lock } from "lucide-react";
import { showSaveCount } from "@/lib/library/activity";
import type { LibraryCardFields } from "@/lib/library/card-fields";
import { KIND_LABELS, READINESS_LABELS, SOURCE_LABELS } from "@/lib/library/taxonomy";
import { cn } from "@/lib/utils";

const MAX_TAGS = 3;

/**
 * The one card every library surface shows an item with. Server- or client-renderable: it is a plain link.
 * The title is the link and stretches over the card, so a screen reader hears the title, not the whole card.
 * Type, source and tags are plain text, not pills, so nothing on a card looks like a filter it is not.
 * It carries no per-member reading data, only the save count (from 3 up) and what a moderator marked public-ready.
 * It takes display fields only (`toCardFields` makes them), so a client component never receives a member id.
 * `compact` drops the summary and tags, for narrow shelves and the dashboard.
 */
export function LibraryItemCard({ card, compact = false, className }: { card: LibraryCardFields; compact?: boolean; className?: string }) {
	const authors = card.authorsJson.map((author) => author.name).join(", ");
	const byline = [authors, card.year ? String(card.year) : ""].filter(Boolean).join(" · ");
	const tags = card.tagNames.slice(0, MAX_TAGS);
	const saved = showSaveCount(card.saves) ? `Saved by ${card.saves.toLocaleString("en-US")}` : "";
	const readiness = card.publicReadiness ? READINESS_LABELS[card.publicReadiness] : "";
	const footer = [saved, readiness].filter(Boolean);

	return (
		<article
			className={cn(
				"relative flex h-full min-w-0 flex-col gap-1 rounded-xl border border-border bg-card transition-colors hover:border-accent! has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
				compact ? "p-3" : "p-4",
				className,
			)}
		>
			<Link
				href={`/portal/library/${card.id}`}
				className={cn("min-w-0 font-medium leading-snug [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none", compact && "line-clamp-2 text-sm")}
			>
				{card.title}
			</Link>
			<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
				<span>
					{KIND_LABELS[card.kind]} · {SOURCE_LABELS[card.source]}
				</span>
				{card.confidentiality === "confidential" ? (
					<span className="inline-flex items-center gap-1 font-medium text-foreground">
						<Lock className="size-3" aria-hidden />
						Confidential
					</span>
				) : null}
			</p>
			{!compact && card.dek ? <p className="line-clamp-2 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{card.dek}</p> : null}
			{byline ? <p className="line-clamp-2 min-w-0 [overflow-wrap:anywhere] text-xs text-muted-foreground">{byline}</p> : null}
			{!compact && tags.length > 0 ? <p className="min-w-0 [overflow-wrap:anywhere] text-xs text-muted-foreground">Tags: {tags.join(", ")}</p> : null}
			{footer.length > 0 ? <p className="mt-auto min-w-0 pt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{footer.join(" · ")}</p> : null}
		</article>
	);
}
