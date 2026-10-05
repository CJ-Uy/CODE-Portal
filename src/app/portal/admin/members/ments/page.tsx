import Link from "next/link";
import { GitBranch } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { MentsEditor } from "./ments-editor";
import { AdminIntro } from "@/components/portal/admin-intro";

export const dynamic = "force-dynamic";

export default async function ManageMentsPage() {
	if (!isFeatureEnabled("ments")) notFound();
	const actor = await requireActor();
	if (!can(actor, "member:manage")) redirect("/portal/ments");
	const repositories = await getRepositories();
	const [people, reports] = await Promise.all([repositories.ments.manage(actor), repositories.ments.pments(actor)]);
	return <div className="grid min-w-0 gap-6"><AdminIntro title="Ments Tree" whoFor="Manage official Ments relationships and review member-reported Pments" effect="Past mentors can be added without a portal account" /><Button asChild variant="outline" size="sm" className="justify-self-start"><Link href="/portal/ments"><GitBranch className="size-4" /> Explore tree</Link></Button><MentsEditor people={people} reports={reports} /></div>;
}
