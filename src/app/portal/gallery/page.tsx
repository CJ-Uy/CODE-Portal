import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { GalleryHome } from "@/components/gallery/gallery-home";
import { requireActor } from "@/server/auth/actor";
import { signInPath } from "@/server/auth/sign-in";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gallery" };

export default async function GalleryPage() {
	const actor = await requireActor().catch(() => null);
	if (!actor) redirect(await signInPath());
	const { gallery } = await getRepositories();
	// The front page makes any missing event albums first, so the album picker below already lists them.
	const home = await gallery.homeView(actor);
	const folderOptions = await gallery.folderOptions(actor);
	return <GalleryHome home={home} folderOptions={folderOptions} />;
}
