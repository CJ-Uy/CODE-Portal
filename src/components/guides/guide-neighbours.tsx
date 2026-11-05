import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Guide } from "@/lib/guides/content";

/** Previous and next guide cards at the foot of a guide. */
export function GuideNeighbours({ prev, next }: { prev?: Guide; next?: Guide }) {
	if (!prev && !next) return null;
	return (
		<nav aria-label="More guides" className="grid min-w-0 gap-3 border-t border-border/60 pt-6 sm:grid-cols-2">
			{prev ? <Neighbour guide={prev} direction="prev" /> : null}
			{next ? <Neighbour guide={next} direction="next" /> : null}
		</nav>
	);
}

function Neighbour({ guide, direction }: { guide: Guide; direction: "prev" | "next" }) {
	const isNext = direction === "next";
	return (
		<Link
			href={`/portal/guides/${guide.slug}`}
			className={`group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
				isNext ? "flex-row-reverse text-right sm:col-start-2" : ""
			}`}
		>
			{isNext ? (
				<ArrowRight className="size-4 shrink-0 text-accent" aria-hidden="true" />
			) : (
				<ArrowLeft className="size-4 shrink-0 text-accent" aria-hidden="true" />
			)}
			<span className="grid min-w-0 gap-0.5">
				<span className="text-xs text-muted-foreground">{isNext ? "Next guide" : "Previous guide"}</span>
				<span className="font-medium [overflow-wrap:anywhere]">{guide.title}</span>
			</span>
		</Link>
	);
}
