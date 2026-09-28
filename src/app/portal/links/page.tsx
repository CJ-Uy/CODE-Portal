import { getRepositories } from "@/db";
import { LinksWorkspace } from "@/components/links/links-workspace";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
	const actor = await requireActor();
	const { links } = await getRepositories();
	const initialPage = await links.searchVisible(actor, { limit: 25, offset: 0, query: "", own: false, tags: [], sort: "created", direction: "desc" });
	const canModerate = actor.roles.includes("link") || actor.roles.includes("super");
	return <LinksWorkspace initialPage={initialPage} actorMemberId={actor.memberId} canModerate={canModerate} />;
}
