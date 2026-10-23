import { DeletedBrowser } from "@/components/gallery/deleted-browser";
import { loadGalleryContext } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recently deleted" };

export default async function RecentlyDeletedPage() {
	const { actor, gallery } = await loadGalleryContext();
	const view = await gallery.listDeleted(actor);
	return <DeletedBrowser items={view.items} folders={view.folders} seesEveryone={view.seesEveryone} />;
}
