"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { galleryFileUrl, galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import type { GalleryTileItem } from "./gallery-timeline";

const dateTaken = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

const stageButton =
	"grid size-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#90b4cc] disabled:pointer-events-none disabled:opacity-30";

/**
 * Full-screen viewer on CODE navy. Arrow keys and swipes move through `items`, Escape closes, I toggles the
 * details panel. The neighbours' previews load ahead so stepping through feels instant.
 */
export function Lightbox<T extends GalleryTileItem>({
	items,
	openId,
	onOpenChange,
	toolbar,
	panel,
	notice,
}: {
	items: T[];
	openId: string | null;
	onOpenChange(id: string | null): void;
	/** Extra buttons in the top bar for the open item (download, edit, move, delete). */
	toolbar?: (item: T) => ReactNode;
	/** The details panel for the open item. Without one, the Info button is hidden. */
	panel?: (item: T) => ReactNode;
	/** What the last action did. Shown inside the viewer, where page toasts cannot reach. */
	notice?: { message: string; action?: { label: string; onClick(): void } } | null;
}) {
	const index = openId ? items.findIndex((item) => item.id === openId) : -1;
	const item = index >= 0 ? items[index] : null;
	const [showPanel, setShowPanel] = useState(false);
	const swipe = useRef<{ x: number; y: number } | null>(null);

	const go = (step: number) => {
		const next = items[index + step];
		if (next) onOpenChange(next.id);
	};

	useEffect(() => {
		for (const neighbour of [items[index - 1], items[index + 1]]) {
			if (neighbour?.kind === "photo") new Image().src = galleryFileUrl(neighbour.fileKey, { width: 1600 });
		}
	}, [index, items]);

	return (
		<Dialog.Root open={Boolean(item)} onOpenChange={(open) => !open && onOpenChange(null)}>
			<Dialog.Portal>
				<Dialog.Content
					aria-describedby={undefined}
					onKeyDown={(event) => {
						// Arrows belong to a focused field or video (seeking), not to the viewer.
						const owned = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(event.target.tagName);
						if (owned) return;
						if (event.key === "ArrowLeft") go(-1);
						else if (event.key === "ArrowRight") go(1);
						else if ((event.key === "i" || event.key === "I") && panel) setShowPanel((value) => !value);
						else return;
						event.preventDefault();
					}}
					className="fixed inset-0 z-50 flex flex-col bg-[#06192f] text-white outline-none motion-safe:animate-[gallery-open_180ms_cubic-bezier(0.16,1,0.3,1)] lg:flex-row"
				>
					{item ? (
						<>
							<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
								<div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-4">
									<div className="flex min-w-0 items-center gap-2">
										<Dialog.Close className={stageButton} aria-label="Close">
											<X className="size-5" />
										</Dialog.Close>
										<span className="text-sm text-white/75 tabular-nums">
											{index + 1} of {items.length}
										</span>
									</div>
									<div className="flex items-center gap-1">
										{toolbar?.(item)}
										{panel ? (
											<button
												type="button"
												className={cn(stageButton, showPanel && "bg-white/15 text-white")}
												aria-pressed={showPanel}
												aria-label="Details"
												title="Details (I)"
												onClick={() => setShowPanel((value) => !value)}
											>
												<Info className="size-5" />
											</button>
										) : null}
									</div>
								</div>
								<Dialog.Title className="sr-only">{item.caption || item.originalName || (item.kind === "video" ? "Video" : "Photo")}</Dialog.Title>

								<div
									className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-2 sm:px-16"
									onPointerDown={(event) => {
										if (event.target instanceof HTMLVideoElement) return;
										swipe.current = { x: event.clientX, y: event.clientY };
									}}
									onPointerUp={(event) => {
										const start = swipe.current;
										swipe.current = null;
										if (!start) return;
										const dx = event.clientX - start.x;
										if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - start.y)) go(dx < 0 ? 1 : -1);
									}}
								>
									<Stage key={item.id} item={item} />
									<button type="button" className={cn(stageButton, "absolute left-3 top-1/2 hidden -translate-y-1/2 sm:grid")} onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous">
										<ChevronLeft className="size-6" />
									</button>
									<button type="button" className={cn(stageButton, "absolute right-3 top-1/2 hidden -translate-y-1/2 sm:grid")} onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next">
										<ChevronRight className="size-6" />
									</button>
								</div>

								{notice ? (
									<div role="status" className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-md items-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm text-[#06192f] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
										<span className="min-w-0 flex-1">{notice.message}</span>
										{notice.action ? (
											<button type="button" onClick={notice.action.onClick} className="shrink-0 rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c315c]">
												{notice.action.label}
											</button>
										) : null}
									</div>
								) : null}
								{!showPanel && (item.caption || item.takenAt) ? (
									<div className="px-4 pb-4 sm:px-16">
										{item.caption ? <p className="max-w-prose whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-white">{item.caption}</p> : null}
										{item.takenAt ? <p className="mt-0.5 text-xs text-white/65">{dateTaken.format(item.takenAt)}</p> : null}
									</div>
								) : null}
							</div>

							{panel && showPanel ? (
								<aside aria-label="Details" className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#0c315c] lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
									{panel(item)}
								</aside>
							) : null}
						</>
					) : null}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function Stage({ item }: { item: GalleryTileItem }) {
	const [loaded, setLoaded] = useState(false);
	const thumb = galleryThumbUrl(item);
	if (item.kind === "video") {
		return (
			<video
				src={galleryFileUrl(item.fileKey)}
				poster={thumb ?? undefined}
				controls
				playsInline
				preload="metadata"
				className="max-h-full max-w-full bg-black"
			/>
		);
	}
	return (
		<div className="relative grid size-full place-items-center">
			{thumb && !loaded ? (
				// The grid's small preview, already cached, holds the frame while the large one arrives.
				// eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy
				<img src={thumb} alt="" aria-hidden className="absolute inset-0 m-auto max-h-full max-w-full object-contain blur-[2px]" />
			) : null}
			{/* eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy, resized there */}
			<img
				src={galleryFileUrl(item.fileKey, { width: 1600 })}
				alt={item.caption ?? ""}
				onLoad={() => setLoaded(true)}
				className={cn("relative max-h-full max-w-full select-none object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
				draggable={false}
			/>
		</div>
	);
}
