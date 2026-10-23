import { GalleryFolderPage } from "../folder-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Not in an album" };

/** Photos at the gallery's top level, outside any album (restored into the top level, or uploaded before albums). */
export default function UnsortedPage() {
	return <GalleryFolderPage folderId={null} />;
}
