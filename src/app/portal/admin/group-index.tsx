import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
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
			<div className="grid gap-3 sm:grid-cols-2">
				{group.pages.map((page) => (
					<Link
						key={page.href}
						href={page.href}
						className="group flex flex-col gap-1 rounded-xl border border-border bg-card p-4 transition-[border-color,transform] hover:border-accent active:scale-[0.99]"
					>
						<span className="font-medium group-hover:text-accent">{page.label}</span>
						<span className="text-sm text-muted-foreground">{page.description}</span>
					</Link>
				))}
			</div>
		</div>
	);
}
