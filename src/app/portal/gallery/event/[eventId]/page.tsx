import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { getRepositories } from "@/db";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { countLabel } from "@/lib/gallery/view";
import { loadGalleryContext } from "../../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event photos" };

/** Every photo for one event: tagged with it, or inside a folder tagged with it. Uploads happen in folders, not here. */
export default async function GalleryEventPage({ params }: { params: Promise<{ eventId: string }> }) {
	const [{ eventId }, context, repositories] = await Promise.all([params, loadGalleryContext(), getRepositories()]);
	const event = await repositories.calendar.getEvent(context.actor, eventId).catch(() => null);
	if (!event) notFound();
	const items = await context.gallery.eventItems(context.actor, eventId);
	return (
		<GalleryBrowser
			title={`Photos from ${event.title}`}
			crumbs={[{ label: "Gallery", href: "/portal/gallery" }, { label: event.title }]}
			meta={
				<>
					<span>{items.length ? countLabel(items) : "No photos yet"}</span>
					<Link href={`/portal/calendar/${eventId}`} className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
						<CalendarDays className="size-3.5" aria-hidden />
						Event page
					</Link>
				</>
			}
			folder={null}
			subfolders={[]}
			items={items}
			folderOptions={context.folderOptions}
			eventOptions={context.eventOptions}
			canManage={context.canManage}
			inheritedEvent={{ id: eventId, title: event.title }}
		/>
	);
}
