import { notFound, redirect } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

// ponytail: stub while library v2 lands. Task 16 rebuilds this page as the moderation queue and tag manager,
// and moves authoring into the shared editor; the v1 create/edit form cannot map onto the v2 content model.
export default async function AdminLibraryPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "library:manage")) redirect("/portal");

	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Library"
				whoFor="Library authoring is moving to the new editor"
				effect="This page returns as the moderation queue and tag manager"
			/>
		</div>
	);
}
