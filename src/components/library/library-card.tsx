import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { showSaveCount } from "@/lib/library/activity";
import type { LibraryCardFields } from "@/lib/library/card-fields";
import { KIND_LABELS, READINESS_LABELS, SOURCE_LABELS } from "@/lib/library/taxonomy";
import { cn } from "@/lib/utils";

const MAX_TAGS = 3;

/**
 * The one card every library surface shows an item with. Server- or client-renderable: it is a plain link.
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
		<Link
			href={`/portal/library/${card.id}`}
			className={cn(
				"flex h-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				compact ? "p-3" : "p-4",
				className,
			)}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-1.5">
				<Badge variant="secondary">{KIND_LABELS[card.kind]}</Badge>
				<Badge variant="outline">{SOURCE_LABELS[card.source]}</Badge>
				{card.confidentiality === "confidential" ? (
					<Badge variant="warn" className="gap-1">
						<Lock className="size-3" aria-hidden />
						Confidential
					</Badge>
				) : null}
			</div>
			<p className={cn("min-w-0 break-all font-medium leading-snug", compact && "line-clamp-2 text-sm")}>{card.title}</p>
			{!compact && card.dek ? <p className="line-clamp-2 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{card.dek}</p> : null}
			{byline ? <p className="line-clamp-2 min-w-0 break-all text-xs text-muted-foreground">{byline}</p> : null}
			{!compact && tags.length > 0 ? (
				<div className="flex min-w-0 flex-wrap gap-1">
					{tags.map((tag) => (
						<Badge key={tag} variant="outline" className="min-w-0 max-w-full break-all font-normal text-muted-foreground">
							{tag}
						</Badge>
					))}
				</div>
			) : null}
			{footer.length > 0 ? <p className="mt-auto min-w-0 pt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{footer.join(" · ")}</p> : null}
		</Link>
	);
}
