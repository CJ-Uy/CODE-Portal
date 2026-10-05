import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { AdminIntro } from "@/components/portal/admin-intro";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { SettingsPanels } from "./settings-panels";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { email } = await getRepositories();
	const [senders, categories] = await Promise.all([
		email.settings.listSenders(actor, { includeArchived: true }),
		email.settings.listCategories(actor, { includeArchived: true }),
	]);
	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Senders & categories"
				whoFor="Senders are the From addresses an email can use"
				effect="Categories group emails; members can turn off optional categories, never required ones"
			/>
			<SettingsPanels senders={senders} categories={categories} />
		</div>
	);
}
