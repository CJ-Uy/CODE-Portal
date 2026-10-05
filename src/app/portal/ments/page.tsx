import Link from "next/link";
import { Settings2 } from "lucide-react";
import { notFound } from "next/navigation";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { MentsTree } from "./ments-tree";

export const dynamic = "force-dynamic";

export default async function MentsPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
	if (!isFeatureEnabled("ments")) notFound();
	const actor = await requireActor();
	const repositories = await getRepositories();
	const people = await repositories.ments.list(actor);
	const params = await searchParams;
	return (
		<div className="grid min-w-0 gap-6">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div><h1 className="font-serif text-3xl">Ments Tree</h1><p className="mt-1 max-w-xl text-muted-foreground">Your ments, their ments, and everyone who follows. Pick a person to explore their line.</p></div>
				{can(actor, "member:manage") ? <Button asChild variant="outline" size="sm"><Link href="/portal/admin/members/ments"><Settings2 className="size-4" /> Manage tree</Link></Button> : null}
			</header>
			<MentsTree people={people} memberId={actor.memberId} initialId={typeof params.person === "string" ? params.person : undefined} />
		</div>
	);
}
