import Link from "next/link";
import { GitBranch } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { MentsEditor } from "./ments-editor";

export const dynamic = "force-dynamic";

export default async function ManageMentsPage() {
	if (!isFeatureEnabled("ments")) notFound();
	const actor = await requireActor();
	if (!can(actor, "member:manage")) redirect("/portal/ments");
	const repositories = await getRepositories();
	const people = await repositories.ments.manage(actor);
	return <div className="grid min-w-0 gap-6"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-serif text-3xl">Manage Ments Tree</h1><p className="mt-1 text-muted-foreground">Keep each person connected to their ments. Past mentors can be added without a portal account.</p></div><Button asChild variant="outline" size="sm"><Link href="/portal/ments"><GitBranch className="size-4" /> Explore tree</Link></Button></header><MentsEditor people={people} /></div>;
}
