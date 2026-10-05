import { notFound } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
import { AdminTools } from "@/components/portal/admin-tools";
import { requireActor } from "@/server/auth/actor";
import { getFeatureFlags } from "@/server/features";
import { visibleGroups } from "./nav";

/**
 * Shared landing for a `/portal/admin/<group>` index route: intro + the group's
 * visible page tiles. Returns notFound() if the actor has no visible page here.
 */
export async function AdminGroupIndex({ segment, whoFor }: { segment: string; whoFor: string }) {
	const actor = await requireActor();
	const group = visibleGroups(actor, getFeatureFlags()).find((g) => g.segment === segment);
	if (!group) notFound();

	return (
		<div className="grid gap-4">
			<AdminIntro title={group.label} whoFor={whoFor} effect="Pick a page below to continue" />
			<AdminTools groups={[group]} showFilters={false} />
		</div>
	);
}
