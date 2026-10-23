import { GalleryFolderPage } from "./folder-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gallery" };

export default function GalleryPage() {
	return <GalleryFolderPage folderId={null} />;
}
