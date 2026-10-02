import { getRepositories } from "@/db";
import { formatEventWhen } from "@/db/repositories/email-campaigns";
import { mergeValuesFor, SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import type { Audience } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";

export async function loadComposerData(actor: Actor, audience: Audience | null) {
	const repos = await getRepositories();
	const memberIds = [...(audience?.include ?? []), ...(audience?.exclude ?? [])].flatMap((r) => (r.kind === "member" ? [r.memberId] : []));
	const [senders, categories, templates, options, me, memberLabels] = await Promise.all([
		repos.email.settings.listSenders(actor),
		repos.email.settings.listCategories(actor),
		repos.email.templates.list(actor),
		repos.email.campaigns.audienceOptions(actor),
		repos.members.getById(actor, actor.memberId),
		repos.email.campaigns.labelsFor(actor, memberIds),
	]);
	return {
		senders: senders.map((s) => ({ id: s.id, address: s.address, displayName: s.displayName })),
		categories: categories.map((c) => ({ id: c.id, name: c.name, required: c.required, defaultSenderId: c.defaultSenderId })),
		templates: templates.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId, subject: t.subject, preheader: t.preheader, blocks: t.blocks })),
		options,
		memberLabels,
		events: options.events.map((e) => ({ id: e.id, title: e.title, when: formatEventWhen(e.startsAt), place: e.place })),
		people: [{ label: "a sample member", values: SAMPLE_MERGE_VALUES }, ...(me ? [{ label: "you", values: mergeValuesFor(me) }] : [])],
		baseUrl: emailConfigFromEnv().publicBaseUrl,
	};
}
