import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { LinkModeration } from "@/components/links/link-moderation";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminLinksPage() {
	const actor = await requireActor();
	if (!can(actor, "link:moderate")) redirect("/portal");
	const { links } = await getRepositories();
	const allLinks = await links.listAll(actor, { limit: 50 });
	return <LinkModeration initialLinks={allLinks} />;
}
