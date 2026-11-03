import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, Heart, ListMusic } from "lucide-react";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { PhotoListControls } from "@/components/gallery/photo-lists";
import { EmptyState } from "@/components/portal/empty-state";
import { countLabel } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import { loadGalleryContext } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your photos" };

export default async function SavedPhotosPage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
	const [params, context] = await Promise.all([searchParams, loadGalleryContext()]);
	const collection = params.collection ?? "saved";
	const lists = await context.gallery.lists(context.actor);
	const list = lists.find((entry) => entry.id === collection);
	if (collection !== "saved" && collection !== "liked" && !list) notFound();
	const view = await context.gallery.browse(context.actor, { sort: "recent", collection });
	const title = list?.name ?? (collection === "liked" ? "Liked by you" : "Saved");
	const options = [{ id: "saved", name: "Saved" }, { id: "liked", name: "Liked by you" }, ...lists];
	return (
		<GalleryBrowser
			title={title}
			crumbs={[{ label: "Gallery", href: "/portal/gallery" }, { label: title }]}
			meta={<span>Only you can see this{view.items.length ? ` · ${countLabel(view.items)}${view.items.length >= 120 ? ", the first 120" : ""}` : ""}</span>}
			folder={null}
			subfolders={[]}
			items={view.items}
			folderOptions={context.folderOptions}
			eventOptions={context.eventOptions}
			memberOptions={context.memberOptions}
			canManage={context.canManage}
			empty={<EmptyState
				icon={collection === "liked" ? Heart : list ? ListMusic : Bookmark}
				title={collection === "liked" ? "No liked photos yet" : list ? "This list is empty" : "No saved photos yet"}
				description={collection === "liked" ? "Tap the heart on a photo to find it here." : list ? "Open a saved photo and choose this list from its bookmark." : "Tap the bookmark beside a photo’s heart to save it here."}
			/>}
		>
			<div className="grid min-w-0 gap-4">
				<nav aria-label="Your photo library" className="flex flex-wrap gap-2">
					{options.map((option) => <Link
						key={option.id}
						href={option.id === "saved" ? "/portal/gallery/saved" : `/portal/gallery/saved?collection=${option.id}`}
						aria-current={option.id === collection ? "page" : undefined}
						className={cn("inline-flex min-h-9 max-w-full items-center rounded-full border px-3.5 py-1.5 text-sm font-medium [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", option.id === collection ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary")}
					>{option.name}</Link>)}
				</nav>
				<PhotoListControls list={list} />
			</div>
		</GalleryBrowser>
	);
}
