"use client";

import { useMemo, useState } from "react";
import type { GalleryPublicItem } from "@/db/repositories/gallery";
import { countLabel, groupByDay } from "@/lib/gallery/view";
import { GalleryTimeline } from "./gallery-timeline";
import { Lightbox } from "./lightbox";

/** The public roll: the same timeline and viewer as the portal, read-only, with nothing about who uploaded. */
export function PublicGallery({ items }: { items: GalleryPublicItem[] }) {
	const [openId, setOpenId] = useState<string | null>(null);
	const groups = useMemo(() => groupByDay(items).map((group) => ({ ...group, detail: countLabel(group.items) })), [items]);
	return (
		<>
			<GalleryTimeline groups={groups} onTile={(item) => setOpenId(item.id)} />
			<Lightbox items={items} openId={openId} onOpenChange={setOpenId} />
		</>
	);
}
