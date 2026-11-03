import { redirect } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { SchoolYearsManager } from "./school-years-manager";

export const dynamic = "force-dynamic";

export default async function SchoolYearsAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "retention:configure")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const rows = await repositories.retention.listTermsAdmin(actor);
	return <div className="grid gap-6"><AdminIntro title="School years" whoFor="Set each school year's dates and when its 2nd semester starts" /><SchoolYearsManager key={JSON.stringify(rows)} rows={rows} /></div>;
}
