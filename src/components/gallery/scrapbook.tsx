"use client";

import { useState } from "react";
import { Heart, ImageOff, Play } from "lucide-react";
import { formatDuration, galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import type { GalleryGroup, GalleryTileItem } from "./gallery-timeline";

type ScrapbookItem = GalleryTileItem & { heartCount?: number };

// Small, fixed tilts read as prints laid on a page; they come from the photo's id so they never jump between renders.
const TILTS = [-1.1, 0.7, -0.4, 1, -0.8, 0.3];
const tiltFor = (id: string) => TILTS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TILTS.length];

/**
 * The album as a scrapbook: prints at their own shape on white mats, captions written under them, a day's prints
 * gathered under its date. Opening a print opens the same lightbox as the grid.
 */
export function Scrapbook<T extends ScrapbookItem>({ groups, onOpen }: { groups: GalleryGroup<T>[]; onOpen(item: T): void }) {
	return (
		<div className="grid gap-10">
			{groups.map((group) => (
				<section key={group.key} aria-labelledby={group.label ? `page-${group.key}` : undefined} className="grid gap-4">
					{group.label ? (
						<h2 id={`page-${group.key}`} className="flex flex-wrap items-baseline gap-x-3">
							<span className="font-heading text-2xl leading-tight">{group.label}</span>
							{group.detail ? <span className="font-sans! text-sm text-muted-foreground">{group.detail}</span> : null}
						</h2>
					) : null}
					<ul className="columns-2 gap-3 sm:columns-3 sm:gap-5 lg:columns-4">
						{group.items.map((item) => (
							<li key={item.id} className="mb-3 break-inside-avoid sm:mb-5">
								<Print item={item} onOpen={() => onOpen(item)} />
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function Print({ item, onOpen }: { item: ScrapbookItem; onOpen(): void }) {
	const [failed, setFailed] = useState(false);
	const src = galleryThumbUrl(item);
	const label = item.caption || item.originalName || (item.kind === "video" ? "Video" : "Photo");
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={`Open ${label}`}
			style={{ rotate: `${tiltFor(item.id)}deg` }}
			className="group block w-full rounded-[3px] bg-white p-1.5 pb-2 text-left shadow-[0_1px_2px_rgba(6,25,47,0.14),0_8px_18px_-10px_rgba(6,25,47,0.35)] outline-none transition-[rotate,translate,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:rotate-0 hover:shadow-[0_2px_4px_rgba(6,25,47,0.14),0_14px_28px_-12px_rgba(6,25,47,0.4)] focus-visible:rotate-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:p-2 sm:pb-2.5"
		>
			<span className="relative block overflow-hidden bg-[#d7dfe9]">
				{src && !failed ? (
					// eslint-disable-next-line @next/next/no-img-element -- served by the access-checked storage proxy, which already resizes
					<img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="block h-auto w-full" />
				) : (
					<span className="grid aspect-[4/3] place-items-center text-[#3d5266]">
						{item.kind === "video" ? <Play className="size-7" aria-hidden /> : <ImageOff className="size-6" aria-hidden />}
					</span>
				)}
				{item.kind === "video" ? (
					<span className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-[#06192f]/80 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
						<Play className="size-3 fill-current" aria-hidden />
						{item.durationSeconds ? formatDuration(item.durationSeconds) : "Video"}
					</span>
				) : null}
			</span>
			{item.caption || item.heartCount ? (
				<span className="flex items-start gap-2 px-1 pt-2">
					{item.caption ? <span className="line-clamp-3 min-w-0 flex-1 [overflow-wrap:anywhere] font-heading text-[0.95rem] italic leading-snug text-[#3d5266]">{item.caption}</span> : <span className="flex-1" />}
					{item.heartCount ? (
						<span className="inline-flex shrink-0 items-center gap-0.5 pt-0.5 text-xs font-semibold text-[#0c315c] tabular-nums" aria-label={`${item.heartCount} ${item.heartCount === 1 ? "heart" : "hearts"}`}>
							<Heart className={cn("size-3.5 fill-current")} aria-hidden />
							{item.heartCount}
						</span>
					) : null}
				</span>
			) : null}
		</button>
	);
}
