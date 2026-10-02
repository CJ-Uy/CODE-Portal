"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import type { CampaignInput } from "@/db/repositories/email-campaigns";
import type { TemplateInput } from "@/db/repositories/email-templates";
import { fromLocalInput } from "@/lib/date-slots";
import { runAction } from "@/lib/email/action-result";
import { emailContentSchema } from "@/lib/email/blocks";
import { mergeValuesFor } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Audience, EmailBlock } from "@/lib/email/types";
import { requireActor } from "@/server/auth/actor";
import { sendingDepsFromEnv } from "@/server/email/db";
import { assertFeatureEnabled } from "@/server/features";

const BASE = "/portal/admin/email";
const idSchema = z.string().min(1).max(64);

async function context() {
	assertFeatureEnabled("email");
	const actor = await requireActor();
	const repos = await getRepositories();
	return { actor, repos, email: repos.email };
}

const done = () => null;

export async function saveSenderAction(input: { id?: string; address: string; displayName: string }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.settings.saveSender(actor, z.object({ id: idSchema.optional(), address: z.string().max(200), displayName: z.string().max(80) }).parse(input));
		revalidatePath(`${BASE}/settings`);
		return row.id;
	});
}

export async function setSenderArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.setSenderArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function saveCategoryAction(input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const parsed = z
			.object({
				id: idSchema.optional(),
				name: z.string().max(60),
				description: z.string().max(200),
				required: z.boolean(),
				defaultSenderId: idSchema.nullable(),
			})
			.parse(input);
		const row = await email.settings.saveCategory(actor, parsed);
		revalidatePath(`${BASE}/settings`);
		return row.id;
	});
}

export async function setCategoryArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.setCategoryArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function moveCategoryAction(id: string, direction: "up" | "down") {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.moveCategory(actor, idSchema.parse(id), z.enum(["up", "down"]).parse(direction));
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function saveTemplateAction(input: TemplateInput) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.templates.save(actor, input);
		revalidatePath(`${BASE}/templates`);
		return row.id;
	});
}

export async function duplicateTemplateAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.templates.duplicate(actor, idSchema.parse(id));
		revalidatePath(`${BASE}/templates`);
		return row.id;
	});
}

export async function setTemplateArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.templates.setArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/templates`);
		return done();
	});
}

export async function saveCampaignAction(input: CampaignInput) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.campaigns.saveDraft(actor, input);
		revalidatePath(BASE);
		return { id: row.id, status: row.status };
	});
}

export async function previewAudienceAction(audience: Audience, categoryId: string | null) {
	return runAction(async () => {
		const { actor, email } = await context();
		return email.campaigns.previewAudience(actor, audience, categoryId ? idSchema.parse(categoryId) : null);
	});
}

export async function searchMembersAction(query: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		return email.campaigns.searchMembers(actor, z.string().max(80).parse(query));
	});
}

export async function testSendAction(input: { subject: string; preheader: string; blocks: EmailBlock[]; categoryId: string | null; senderId: string | null }) {
	return runAction(async () => {
		const { actor, repos, email } = await context();
		const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
		const [senders, categories, me] = await Promise.all([
			email.settings.listSenders(actor),
			email.settings.listCategories(actor),
			repos.members.getById(actor, actor.memberId),
		]);
		const from = senders.find((s) => s.id === input.senderId) ?? senders[0];
		if (!from) throw new Error("Add a sender in Email settings first.");
		if (!me) throw new Error("Your member profile was not found.");
		const category = categories.find((c) => c.id === input.categoryId);
		const { sender, config } = sendingDepsFromEnv();
		const values = mergeValuesFor(me);
		const rendered = renderEmail({
			...content,
			resolve: valueResolver(values),
			values,
			baseUrl: config.publicBaseUrl,
			footer: {
				categoryName: category?.name ?? "Test",
				required: category?.required ?? true,
				archiveUrl: null,
				preferencesUrl: `${config.publicBaseUrl}/portal/mail/preferences`,
				unsubscribeUrl: category && !category.required ? `${config.publicBaseUrl}/unsubscribe` : null,
			},
		});
		await sender.send({
			to: me.email,
			from: { email: from.address, name: from.displayName },
			replyTo: config.inboxAddress,
			subject: `[Test] ${rendered.subject}`,
			html: rendered.html,
			text: rendered.text,
		});
		await repos.audit.record(actor, { action: "email:test_send", targetType: "member", targetId: actor.memberId, category: "email" });
		return { to: me.email };
	});
}

export async function scheduleCampaignAction(id: string, timing: { mode: "now" } | { mode: "at"; local: string }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const parsed = z
			.discriminatedUnion("mode", [z.object({ mode: z.literal("now") }), z.object({ mode: z.literal("at"), local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) })])
			.parse(timing);
		// "Send now" waits two minutes so the report page can offer Undo.
		const at = parsed.mode === "now" ? new Date(Date.now() + 2 * 60_000) : fromLocalInput(parsed.local);
		const row = await email.campaigns.schedule(actor, idSchema.parse(id), at);
		revalidatePath(BASE);
		return { id: row.id };
	});
}

export async function unscheduleCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.campaigns.unschedule(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return done();
	});
}

export async function cancelCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.campaigns.cancel(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return done();
	});
}

export async function retryFailedAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const count = await email.campaigns.retryFailed(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return count;
	});
}

export async function duplicateCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.campaigns.duplicate(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return row.id;
	});
}

export async function replyThreadAction(threadId: string, body: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.reply(actor, idSchema.parse(threadId), z.string().max(20_000).parse(body), sendingDepsFromEnv());
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}

export async function setThreadStatusAction(threadId: string, status: "open" | "done") {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.setStatus(actor, idSchema.parse(threadId), z.enum(["open", "done"]).parse(status));
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}

export async function assignThreadAction(threadId: string, assigneeId: string | null) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.assign(actor, idSchema.parse(threadId), assigneeId ? idSchema.parse(assigneeId) : null);
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}
