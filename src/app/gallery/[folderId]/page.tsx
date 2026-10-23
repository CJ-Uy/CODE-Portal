import type { Metadata } from "next";
import { PublicGalleryPage } from "../public-folder-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gallery — CODE" };

export default async function PublicGalleryFolder({ params }: { params: Promise<{ folderId: string }> }) {
	return <PublicGalleryPage folderId={(await params).folderId} />;
}
