import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { formatEventWhen } from "@/db/repositories/email-campaigns";
import { mergeValuesFor, SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { id } = await params;
	const repos = await getRepositories();
	const [template, categories, options, me] = await Promise.all([
		id === "new" ? Promise.resolve(null) : repos.email.templates.get(actor, id),
		repos.email.settings.listCategories(actor),
		repos.email.campaigns.audienceOptions(actor),
		repos.members.getById(actor, actor.memberId),
	]);
	if (id !== "new" && !template) notFound();
	const { publicBaseUrl } = emailConfigFromEnv();
	return (
		<TemplateEditor
			initial={
				template ?? { id: null, name: "", categoryId: categories[0]?.id ?? null, subject: "", preheader: "", blocks: [] }
			}
			categories={categories.map((c) => ({ id: c.id, name: c.name, required: c.required }))}
			events={options.events.map((e) => ({ id: e.id, title: e.title, when: formatEventWhen(e.startsAt), place: e.place }))}
			people={[
				{ label: "a sample member", values: SAMPLE_MERGE_VALUES },
				...(me ? [{ label: "you", values: mergeValuesFor(me) }] : []),
			]}
			baseUrl={publicBaseUrl}
		/>
	);
}
