import { redirect } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { PointTypesManager } from "./point-types-manager";

export const dynamic = "force-dynamic";

export default async function PointTypesAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "retention:configure")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const rows = await repositories.pointTypes.list();
	return <div className="grid gap-6"><AdminIntro title="Point types" whoFor="Set the point categories available for event awards" /><PointTypesManager key={JSON.stringify(rows)} rows={rows} /></div>;
}
