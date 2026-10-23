import Link from "next/link";
import { Folder, Globe } from "lucide-react";
import type { GalleryFolderCard } from "@/db/repositories/gallery";
import { galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";

function meta(folder: GalleryFolderCard): string {
	const parts = [];
	if (folder.itemCount || !folder.folderCount) parts.push(`${folder.itemCount} ${folder.itemCount === 1 ? "item" : "items"}`);
	if (folder.folderCount) parts.push(`${folder.folderCount} ${folder.folderCount === 1 ? "folder" : "folders"}`);
	return parts.join(" · ");
}

/**
 * Folders as covers. `grid` when the folder holds only folders (the top level, usually); `strip` above a roll
 * of photos, scrolling sideways so the photos stay in the first viewport.
 */
export function FolderCards({ folders, hrefFor, layout, showPublic = true }: { folders: GalleryFolderCard[]; hrefFor(id: string): string; layout: "grid" | "strip"; showPublic?: boolean }) {
	return (
		<ul
			className={cn(
				layout === "grid"
					? "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4"
					: "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 [scrollbar-width:thin]",
			)}
		>
			{folders.map((folder) => {
				const cover = folder.cover ? galleryThumbUrl(folder.cover) : null;
				return (
					<li key={folder.id} className={cn("min-w-0", layout === "strip" && "w-40 shrink-0 snap-start sm:w-48")}>
						<Link href={hrefFor(folder.id)} className="group grid gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
							<span className="relative block aspect-[4/3] overflow-hidden rounded-md bg-secondary">
								{cover ? (
									// eslint-disable-next-line @next/next/no-img-element -- served by the access-checked storage proxy
									<img src={cover} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
								) : (
									<span className="grid size-full place-items-center text-accent">
										<Folder className="size-9" strokeWidth={1.5} aria-hidden />
									</span>
								)}
								{showPublic && folder.isPublic ? (
									<span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-[#06192f] shadow-[0_1px_2px_rgba(6,25,47,0.25)]">
										<Globe className="size-3" aria-hidden />
										Public
									</span>
								) : null}
							</span>
							<span className="grid min-w-0 gap-0.5">
								<span className="line-clamp-2 [overflow-wrap:anywhere] font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{folder.name}</span>
								<span className="text-sm text-muted-foreground">{meta(folder)}</span>
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
