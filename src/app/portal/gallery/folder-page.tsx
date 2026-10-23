import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Globe } from "lucide-react";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { countLabel } from "@/lib/gallery/view";
import { isFeatureEnabled } from "@/server/features";
import { loadGalleryContext } from "./load";

/** The top level (`folderId` null) and every folder share this page. */
export async function GalleryFolderPage({ folderId }: { folderId: string | null }) {
	const { actor, gallery, folderOptions, eventOptions, canManage } = await loadGalleryContext();
	const view = await gallery.folderView(actor, folderId);
	if (!view) notFound();
	const { folder } = view;
	const isPublic = Boolean(folder && (folder.isPublic || folder.publicFromParent));
	const counts = [view.items.length ? countLabel(view.items) : null, view.folders.length ? `${view.folders.length} ${view.folders.length === 1 ? "folder" : "folders"}` : null].filter(Boolean);

	return (
		<GalleryBrowser
			title={folder?.name ?? "Gallery"}
			crumbs={[{ label: "Gallery", href: folder ? "/portal/gallery" : undefined }, ...view.path.map((crumb, index) => ({ label: crumb.name, href: index < view.path.length - 1 ? `/portal/gallery/${crumb.id}` : undefined }))].slice(folder ? 0 : 1)}
			meta={
				<>
					<span>{counts.length ? counts.join(" · ") : folder ? "Empty folder" : "Photos and videos from CODE, shared by members"}</span>
					{folder?.eventId ? (
						<Link href={`/portal/calendar/${folder.eventId}`} className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
							<CalendarDays className="size-3.5" aria-hidden />
							{folder.eventTitle ?? "Event"}
						</Link>
					) : null}
					{isPublic ? (
						<span className="inline-flex items-center gap-1 font-medium text-accent">
							<Globe className="size-3.5" aria-hidden />
							{isFeatureEnabled("publicSite") ? (
								<Link href={`/gallery/${folder!.id}`} className="underline-offset-4 hover:underline">
									Public on the website
								</Link>
							) : (
								"Public"
							)}
						</span>
					) : null}
				</>
			}
			folder={folder}
			subfolders={view.folders}
			items={view.items}
			folderOptions={folderOptions}
			eventOptions={eventOptions}
			canManage={canManage}
			uploadFolderId={folderId}
			inheritedEvent={view.inheritedEvent}
		/>
	);
}
