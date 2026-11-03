import { GalleryFolderPage } from "../folder-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gallery" };

export default async function GalleryFolder({ params }: { params: Promise<{ folderId: string }> }) {
	const { folderId } = await params;
	return <GalleryFolderPage folderId={folderId} />;
}
