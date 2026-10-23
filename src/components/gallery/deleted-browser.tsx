"use client";

import { useMemo, useState } from "react";
import { Check, Folder, RotateCcw, Trash2, X } from "lucide-react";
import type { GalleryDeletedFolder, GalleryDeletedItem } from "@/db/repositories/gallery";
import { Breadcrumb } from "@/components/portal/breadcrumb";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { daysLeftLabel, GALLERY_BATCH, galleryThumbUrl, groupByDaysLeft } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import { restoreAction } from "@/app/portal/gallery/actions";
import { GalleryTimeline } from "./gallery-timeline";

const names = (people: string[]) => {
	const unique = [...new Set(people)];
	return unique.length <= 2 ? unique.join(" and ") : `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
};

/**
 * Recently deleted, as the same roll grouped by days left instead of the day taken. Tiles are always
 * checkboxes here: the only thing to do with a deleted photo is bring it back.
 */
export function DeletedBrowser({ items, folders, seesEveryone }: { items: GalleryDeletedItem[]; folders: GalleryDeletedFolder[]; seesEveryone: boolean }) {
	const toast = useToast();
	const [picked, setSelected] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const restorable = useMemo(() => [...items.filter((item) => item.canRestore).map((item) => item.id), ...folders.filter((folder) => folder.canRestore).map((folder) => folder.id)], [items, folders]);
	// Whatever was restored (here or by someone else) drops out of the selection with the next refresh.
	const selected = useMemo(() => new Set([...picked].filter((id) => restorable.includes(id))), [picked, restorable]);
	const groups = useMemo(
		() =>
			groupByDaysLeft(items).map((group) => ({
				key: String(group.daysLeft),
				label: group.label,
				items: group.items,
				detail: `${group.items.length} ${group.items.length === 1 ? "item" : "items"}, deleted by ${names(group.items.map((item) => item.deletedByName))}`,
			})),
		[items],
	);

	function toggle(id: string) {
		if (!restorable.includes(id)) return;
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function restore(ids: string[]) {
		const folderIds = ids.filter((id) => folders.some((folder) => folder.id === id));
		const itemIds = ids.filter((id) => !folderIds.includes(id));
		setBusy(true);
		let error: string | null = null;
		for (let start = 0; start < Math.max(itemIds.length, folderIds.length) && !error; start += GALLERY_BATCH) {
			const result = await restoreAction({ itemIds: itemIds.slice(start, start + GALLERY_BATCH), folderIds: folderIds.slice(start, start + GALLERY_BATCH) });
			if (!result.ok) error = result.error;
		}
		setBusy(false);
		toast({ message: error ?? `Restored ${ids.length} ${ids.length === 1 ? "item" : "items"} to where ${ids.length === 1 ? "it was" : "they were"}.` });
		if (!error) setSelected(new Set());
	}

	return (
		<div className="grid gap-6 [--gallery-sticky-top:3.5rem] lg:[--gallery-sticky-top:4.25rem]">
			<header className="grid gap-3">
				<Breadcrumb items={[{ label: "Gallery", href: "/portal/gallery" }, { label: "Recently deleted" }]} />
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
					<div className="grid min-w-0 gap-1">
						<h1 className="font-heading text-3xl leading-tight sm:text-4xl">Recently deleted</h1>
						<p className="max-w-2xl text-sm text-muted-foreground">
							Photos, videos and folders stay here for 30 days, then they are removed for good.{" "}
							{seesEveryone ? "As a photo gallery admin you see and can restore everyone's deletions." : "You see what you deleted; a photo gallery admin can restore anything."}
						</p>
					</div>
					{restorable.length ? (
						<Button variant="outline" disabled={busy} onClick={() => void restore(restorable)}>
							<RotateCcw />
							Restore all
						</Button>
					) : null}
				</div>
			</header>

			{folders.length ? (
				<section aria-labelledby="deleted-folders" className="grid gap-2">
					<h2 id="deleted-folders" className="font-heading text-xl">
						Folders
					</h2>
					<ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
						{folders.map((folder) => {
							const cover = folder.cover ? galleryThumbUrl(folder.cover) : null;
							const isSelected = selected.has(folder.id);
							return (
								<li key={folder.id}>
									<button
										type="button"
										onClick={() => toggle(folder.id)}
										disabled={!folder.canRestore}
										aria-pressed={isSelected}
										className={cn(
											"flex w-full min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
											isSelected ? "border-accent bg-secondary" : "border-border bg-card hover:bg-secondary/50",
										)}
									>
										<span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary text-accent">
											{cover ? (
												// eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy
												<img src={cover} alt="" loading="lazy" className="size-full object-cover" />
											) : (
												<Folder className="size-7" strokeWidth={1.5} aria-hidden />
											)}
										</span>
										<span className="grid min-w-0 flex-1 gap-0.5">
											<span className="truncate font-medium">{folder.name}</span>
											<span className="text-sm text-muted-foreground">
												{folder.itemCount} {folder.itemCount === 1 ? "item" : "items"} · {daysLeftLabel(folder.daysLeft)}
											</span>
											<span className="truncate text-xs text-muted-foreground">Deleted by {folder.deletedByName}</span>
										</span>
										<span
											aria-hidden
											className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", isSelected ? "border-accent bg-[#0c315c] text-white" : "border-border text-transparent")}
										>
											<Check className="size-3.5" strokeWidth={3} />
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}

			{items.length ? (
				<GalleryTimeline groups={groups} selecting selected={selected} onTile={(item) => toggle(item.id)} badge={(item) => (item.daysLeft <= 0 ? "Today" : item.daysLeft === 1 ? "1 day" : `${item.daysLeft} days`)} />
			) : folders.length === 0 ? (
				<EmptyState icon={Trash2} title="Nothing deleted" description="When you delete a photo, video or folder, it waits here for 30 days in case you want it back." />
			) : null}

			{selected.size ? (
				<div role="toolbar" aria-label="Selected" className="fixed inset-x-3 bottom-24 z-40 mx-auto lg:left-[15.75rem] flex max-w-md items-center gap-1 rounded-lg bg-primary px-3 py-2 text-primary-foreground shadow-[0_12px_32px_-8px_rgba(6,25,47,0.45)] md:bottom-6">
					<p className="mr-auto px-1 text-sm font-semibold tabular-nums" aria-live="polite">
						{selected.size} selected
					</p>
					<Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" disabled={busy} onClick={() => void restore([...selected])}>
						<RotateCcw />
						{busy ? "Restoring..." : "Restore"}
					</Button>
					<Button size="icon" variant="ghost" className="size-8 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
						<X />
					</Button>
				</div>
			) : null}
		</div>
	);
}
