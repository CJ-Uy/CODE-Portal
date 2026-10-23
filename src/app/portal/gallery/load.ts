import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { canManageGallery } from "@/db/repositories/gallery";
import { requireActor } from "@/server/auth/actor";
import { signInPath } from "@/server/auth/sign-in";

/** What every member gallery page needs besides its own items: the move picker, the event picker and admin rights. */
export async function loadGalleryContext() {
	const actor = await requireActor().catch(() => null);
	if (!actor) redirect(await signInPath());
	const { gallery } = await getRepositories();
	const [folderOptions, eventOptions, memberOptions] = await Promise.all([gallery.folderOptions(actor), gallery.eventOptions(actor), gallery.memberOptions(actor)]);
	return { actor, gallery, folderOptions, eventOptions, memberOptions, canManage: canManageGallery(actor) };
}
