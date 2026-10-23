import Link from "next/link";
import { Folder, Globe, ImagePlus } from "lucide-react";
import type { GalleryFolderCard } from "@/db/repositories/gallery";
import { galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";

const eventDay = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

function meta(folder: GalleryFolderCard, showDate: boolean): string {
	const parts = [];
	if (showDate && folder.eventDate) parts.push(eventDay.format(folder.eventDate));
	if (folder.itemCount) parts.push(`${folder.itemCount} ${folder.itemCount === 1 ? "photo" : "photos"}`);
	if (folder.folderCount) parts.push(`${folder.folderCount} ${folder.folderCount === 1 ? "album" : "albums"}`);
	if (!folder.itemCount && !folder.folderCount) parts.push("Empty");
	return parts.join(" · ");
}

/**
 * Albums as covers. `grid` for a page of albums; `strip` above a page of photos (and for recent events), scrolling
 * sideways so the photos stay in view. An empty album's cover invites the first photos instead of showing a blank.
 */
export function FolderCards({
	folders,
	hrefFor,
	layout,
	showPublic = true,
	showDate = false,
	size = "default",
}: {
	folders: GalleryFolderCard[];
	hrefFor(id: string): string;
	layout: "grid" | "strip";
	showPublic?: boolean;
	/** Put the event's date first, for event albums. */
	showDate?: boolean;
	/** `large` for the front page's recent events. */
	size?: "default" | "large";
}) {
	return (
		<ul
			className={cn(
				layout === "grid"
					? "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4"
					: "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 [scrollbar-width:thin]",
			)}
		>
			{folders.map((folder) => {
				const cover = folder.cover ? galleryThumbUrl(folder.cover) : null;
				const empty = !folder.itemCount && !folder.folderCount;
				return (
					<li key={folder.id} className={cn("min-w-0", layout === "strip" && (size === "large" ? "w-60 shrink-0 snap-start sm:w-72" : "w-40 shrink-0 snap-start sm:w-48"))}>
						<Link href={hrefFor(folder.id)} className="group grid gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background">
							<span
								className={cn(
									"relative block aspect-[4/3] overflow-hidden rounded-md bg-secondary",
									empty && "border-2 border-dashed border-[#90b4cc]! bg-card",
								)}
							>
								{cover ? (
									// eslint-disable-next-line @next/next/no-img-element -- served by the access-checked storage proxy
									<img src={cover} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
								) : empty ? (
									<span className="grid size-full place-content-center justify-items-center gap-1.5 text-accent">
										<ImagePlus className="size-7" strokeWidth={1.5} aria-hidden />
										<span className="text-sm font-semibold">Add photos</span>
									</span>
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
								<span className={cn("line-clamp-2 [overflow-wrap:anywhere] font-medium leading-snug group-hover:underline group-hover:underline-offset-4", size === "large" && "text-base sm:text-lg")}>{folder.name}</span>
								<span className="text-sm text-muted-foreground">{meta(folder, showDate)}</span>
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
