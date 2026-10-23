"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ImageOff, Play } from "lucide-react";
import type { GalleryItemView } from "@/db/repositories/gallery";
import { countLabel, formatDuration, galleryThumbUrl } from "@/lib/gallery/view";

const SHOWN = 8;

/** The event page's photo row: the newest few, each opening in the event's gallery view. Renders nothing without photos. */
export function EventPhotos({ eventId, items }: { eventId: string; items: GalleryItemView[] }) {
	if (items.length === 0) return null;
	const href = `/portal/gallery/event/${eventId}`;
	return (
		<section aria-labelledby="event-photos" className="grid gap-3">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 id="event-photos" className="font-heading text-xl">
					Photos
				</h2>
				<Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
					See all {countLabel(items)}
					<ArrowRight className="size-3.5" aria-hidden />
				</Link>
			</div>
			<ul className="grid grid-cols-4 gap-0.5 sm:grid-cols-8">
				{items.slice(0, SHOWN).map((item) => (
					<li key={item.id}>
						<Thumb item={item} href={`${href}?photo=${item.id}`} />
					</li>
				))}
			</ul>
		</section>
	);
}

/** Same fallbacks as the gallery's own tiles: a centred icon for a video with no poster frame or an image that will not load. */
function Thumb({ item, href }: { item: GalleryItemView; href: string }) {
	const [failed, setFailed] = useState(false);
	const src = galleryThumbUrl(item);
	return (
		<Link
			href={href}
			className="relative block aspect-square overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			aria-label={item.caption || item.originalName || (item.kind === "video" ? "Video" : "Photo")}
		>
			{src && !failed ? (
				// eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy
				<img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
			) : (
				<span className="grid size-full place-items-center text-muted-foreground">
					{item.kind === "video" ? <Play className="size-6" aria-hidden /> : <ImageOff className="size-5" aria-hidden />}
				</span>
			)}
			{item.kind === "video" ? (
				<span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[0.7rem] font-semibold text-white tabular-nums">
					<Play className="size-2.5 fill-current" aria-hidden />
					{item.durationSeconds ? formatDuration(item.durationSeconds) : "Video"}
				</span>
			) : null}
		</Link>
	);
}
