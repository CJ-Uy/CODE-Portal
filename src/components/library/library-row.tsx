import Link from "next/link";
import { Lock } from "lucide-react";
import { showSaveCount } from "@/lib/library/activity";
import type { LibraryCardFields } from "@/lib/library/card-fields";
import { KIND_LABELS } from "@/lib/library/taxonomy";

/** The sheet's columns. The header row and every item row share it, so the columns line up at every width. */
export const ROW_GRID = "md:grid-cols-[minmax(0,1fr)_8rem_3.5rem] lg:grid-cols-[minmax(0,1fr)_8rem_minmax(0,12rem)_3.5rem_4rem]";

/** Column names over the rows, from the width where rows become columns. Screen readers get each row's facts in its own text. */
export function LibraryRowHeader() {
	return (
		<div aria-hidden className={`hidden gap-x-4 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid ${ROW_GRID}`}>
			<span>Title</span>
			<span>Type</span>
			<span className="hidden lg:block">By</span>
			<span>Year</span>
			<span className="hidden text-right lg:block">Saves</span>
		</div>
	);
}

/**
 * One item as a sheet row: the title is the link and covers the whole row, so the link's name is the title alone.
 * On a phone the columns fold into one line under the title. Takes display fields only, so a client list can render it.
 */
export function LibraryRow({ card }: { card: LibraryCardFields }) {
	const authors = card.authorsJson.map((author) => author.name).join(", ");
	const saves = showSaveCount(card.saves) ? card.saves.toLocaleString("en-US") : "";
	const folded = [KIND_LABELS[card.kind], authors, card.year ? String(card.year) : ""].filter(Boolean).join(" · ");

	return (
		<li className={`relative grid min-w-0 gap-x-4 gap-y-0.5 px-4 py-3 transition-colors hover:bg-secondary/40 has-[a:focus-visible]:bg-secondary/40 ${ROW_GRID}`}>
			<div className="grid min-w-0 gap-0.5">
				<p className="flex min-w-0 items-start gap-1.5">
					<Link
						href={`/portal/library/${card.id}`}
						className="line-clamp-2 min-w-0 font-medium leading-snug [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
					>
						{card.title}
					</Link>
					{card.confidentiality === "confidential" ? (
						<span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
							<Lock className="size-3" aria-hidden />
							Confidential
						</span>
					) : null}
				</p>
				{card.dek.trim() ? <p className="min-w-0 truncate text-sm text-muted-foreground">{card.dek}</p> : null}
				<p className="min-w-0 truncate text-xs text-muted-foreground md:hidden">
					{folded}
					{saves ? ` · Saved by ${saves}` : ""}
				</p>
			</div>
			<span className="hidden min-w-0 pt-0.5 text-sm text-muted-foreground md:block">{KIND_LABELS[card.kind]}</span>
			<span className="hidden min-w-0 truncate pt-0.5 text-sm text-muted-foreground lg:block">{authors}</span>
			<span className="hidden pt-0.5 text-sm tabular-nums text-muted-foreground md:block">{card.year ?? ""}</span>
			<span className="hidden pt-0.5 text-right text-sm tabular-nums text-muted-foreground lg:block">{saves}</span>
		</li>
	);
}
