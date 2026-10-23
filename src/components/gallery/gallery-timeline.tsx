"use client";

import { useState } from "react";
import { Check, ImageOff, Play } from "lucide-react";
import { formatDuration, galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";

export type GalleryTileItem = {
	id: string;
	kind: "photo" | "video";
	fileKey: string;
	posterKey: string | null;
	durationSeconds: number | null;
	caption: string | null;
	takenAt: Date | null;
	createdAt?: Date;
	originalName?: string;
};

export type GalleryGroup<T extends GalleryTileItem> = { key: string; label: string; detail?: string; items: T[] };

/**
 * The roll: one section per group (a day, or a number of days left), its header sticking under the portal
 * header while its photos scroll past, square tiles packed edge to edge.
 */
export function GalleryTimeline<T extends GalleryTileItem>({
	groups,
	selected,
	selecting = false,
	onTile,
	badge,
	stickyTop = "top-[var(--gallery-sticky-top,0px)]",
}: {
	groups: GalleryGroup<T>[];
	/** Present while choosing photos: tiles become checkboxes. */
	selected?: Set<string>;
	selecting?: boolean;
	onTile(item: T): void;
	/** A short label in a tile's corner (Recently deleted shows the days left). */
	badge?: (item: T) => string;
	stickyTop?: string;
}) {
	return (
		<div className="grid gap-6">
			{groups.map((group) => (
				<section key={group.key} aria-labelledby={`day-${group.key}`} className="grid">
					<h2
						id={`day-${group.key}`}
						className={cn("sticky z-10 -mx-1 flex flex-wrap items-baseline gap-x-3 bg-background/95 px-1 py-2.5 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80", stickyTop)}
					>
						<span className="font-heading text-xl leading-tight">{group.label}</span>
						<span className="font-sans text-sm text-muted-foreground">{group.detail ?? `${group.items.length} ${group.items.length === 1 ? "item" : "items"}`}</span>
					</h2>
					<ul className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
						{group.items.map((item) => (
							<li key={item.id} className="min-w-0">
								<Tile item={item} selecting={selecting} selected={selected?.has(item.id) ?? false} badge={badge?.(item)} onClick={() => onTile(item)} />
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function Tile({ item, selecting, selected, badge, onClick }: { item: GalleryTileItem; selecting: boolean; selected: boolean; badge?: string; onClick(): void }) {
	const [failed, setFailed] = useState(false);
	const src = galleryThumbUrl(item);
	const label = item.caption || item.originalName || (item.kind === "video" ? "Video" : "Photo");
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selecting ? selected : undefined}
			aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${label}` : `Open ${label}`}
			className={cn(
				"group relative block aspect-square w-full overflow-hidden bg-muted outline-none transition-colors focus-visible:z-[1] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				selected && "bg-secondary",
			)}
		>
			{src && !failed ? (
				// eslint-disable-next-line @next/next/no-img-element -- served by the access-checked storage proxy, which already resizes
				<img
					src={src}
					alt=""
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
					className={cn(
						"size-full object-cover transition-transform duration-200 ease-out motion-reduce:transition-none",
						selected ? "scale-[0.86]" : selecting ? "" : "group-hover:scale-[1.03]",
					)}
				/>
			) : (
				<span className="grid size-full place-items-center text-muted-foreground">
					{item.kind === "video" ? <Play className="size-7" aria-hidden /> : <ImageOff className="size-6" aria-hidden />}
				</span>
			)}
			{item.kind === "video" ? (
				<span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-5 text-xs font-semibold text-white tabular-nums">
					<Play className="size-3 fill-current" aria-hidden />
					{item.durationSeconds ? formatDuration(item.durationSeconds) : "Video"}
				</span>
			) : null}
			{badge ? (
				<span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-[#06192f]/80 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{badge}</span>
			) : null}
			{selecting ? (
				<span
					aria-hidden
					className={cn(
						"absolute left-2 top-2 grid size-6 place-items-center rounded-full border-2 shadow-[0_1px_3px_rgba(6,25,47,0.45)] transition-colors",
						selected ? "border-white bg-[#0c315c] text-white" : "border-white/90 bg-black/15 text-transparent",
					)}
				>
					<Check className="size-3.5" strokeWidth={3} />
				</span>
			) : null}
		</button>
	);
}
