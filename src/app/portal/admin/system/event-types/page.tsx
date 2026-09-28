import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEventTypes } from "@/lib/event-type-load";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { EventTypeRulesManager } from "./event-type-rules-manager";

export const dynamic = "force-dynamic";

export default async function EventTypesAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "role:assign")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	if (!typeLoad.ok) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Event Type Rules</CardTitle>
					<CardDescription>
						Event types could not be loaded, so they are not shown. Saving is disabled - editing from here
						would risk overwriting the real configuration with a blank one.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return <EventTypeRulesManager key={JSON.stringify(typeLoad.rows)} rows={typeLoad.rows} />;
}
