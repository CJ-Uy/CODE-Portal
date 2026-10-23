import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Globe } from "lucide-react";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { countLabel } from "@/lib/gallery/view";
import { isFeatureEnabled } from "@/server/features";
import { loadGalleryContext } from "./load";

/** Every album shares this page; `folderId` null lists the photos that are not in any album. */
export async function GalleryFolderPage({ folderId }: { folderId: string | null }) {
	const { actor, gallery, folderOptions, eventOptions, memberOptions, canManage } = await loadGalleryContext();
	const view = await gallery.folderView(actor, folderId);
	if (!view) notFound();
	const { folder } = view;
	const isPublic = Boolean(folder && (folder.isPublic || folder.publicFromParent));
	const counts = [view.items.length ? countLabel(view.items) : null, view.folders.length ? `${view.folders.length} ${view.folders.length === 1 ? "album" : "albums"}` : null].filter(Boolean);

	return (
		<GalleryBrowser
			title={folder?.name ?? "Not in an album"}
			crumbs={[
				{ label: "Gallery", href: "/portal/gallery" },
				...(folder ? view.path.map((crumb, index) => ({ label: crumb.name, href: index < view.path.length - 1 ? `/portal/gallery/${crumb.id}` : undefined })) : [{ label: "Not in an album" }]),
			]}
			meta={
				<>
					<span>{counts.length ? counts.join(" · ") : "Empty album"}</span>
					{folder?.eventId ? (
						<Link href={`/portal/calendar/${folder.eventId}`} className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
							<CalendarDays className="size-3.5" aria-hidden />
							{folder.eventTitle && folder.eventTitle !== folder.name ? folder.eventTitle : "Event page"}
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
			memberOptions={memberOptions}
			canManage={canManage}
			uploadFolderId={folderId}
			inheritedEvent={view.inheritedEvent}
		/>
	);
}
