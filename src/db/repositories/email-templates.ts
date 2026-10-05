import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailTemplates } from "@/db/schema";
import { emailContentSchema } from "@/lib/email/blocks";
import { createId } from "@/lib/ids";
import type { EmailBlock } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import type { EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type EmailTemplateRow = InferSelectModel<typeof emailTemplates>;
export type TemplateListItem = EmailTemplateRow & { usedCount: number; categoryName: string | null };
export type TemplateInput = { id?: string; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] };

export function createEmailTemplatesRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_template", targetId, category: "email", detail: detail ?? null });

	async function get(actor: Actor, id: string): Promise<EmailTemplateRow | null> {
		assertEmail(actor, "email:send");
		const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
		return row ?? null;
	}

	async function save(actor: Actor, input: TemplateInput): Promise<EmailTemplateRow> {
		assertEmail(actor, "email:configure");
		const name = input.name.trim();
		if (!name) throw new Error("Add a template name.");
		const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
		const values = { name, categoryId: input.categoryId, ...content, updatedBy: actor.memberId, updatedAt: new Date() };
		const [row] = input.id
			? await db.update(emailTemplates).set(values).where(eq(emailTemplates.id, input.id)).returning()
			: await db
					.insert(emailTemplates)
					.values({ id: createId("etpl"), ...values, createdBy: actor.memberId })
					.returning();
		if (!row) throw new Error("Template not found.");
		await record(actor, input.id ? "email:template_update" : "email:template_create", row.id, name);
		return row;
	}

	return {
		get,
		save,

		async list(actor: Actor, opts?: { q?: string; includeArchived?: boolean }): Promise<TemplateListItem[]> {
			assertEmail(actor, "email:send");
			const q = opts?.q?.trim();
			const rows = await db
				.select({ template: emailTemplates, categoryName: emailCategories.name })
				.from(emailTemplates)
				.leftJoin(emailCategories, eq(emailCategories.id, emailTemplates.categoryId))
				.where(
					and(
						opts?.includeArchived ? undefined : isNull(emailTemplates.archivedAt),
						q ? or(like(emailTemplates.name, `%${q}%`), like(emailTemplates.subject, `%${q}%`)) : undefined,
					),
				)
				.orderBy(desc(emailTemplates.updatedAt));
			const ids = rows.map((r) => r.template.id);
			const usage = ids.length
				? await db
						.select({ templateId: emailCampaigns.templateId, count: sql<number>`count(*)` })
						.from(emailCampaigns)
						.where(and(inArray(emailCampaigns.templateId, ids), inArray(emailCampaigns.status, ["sending", "sent"])))
						.groupBy(emailCampaigns.templateId)
				: [];
			const used = new Map(usage.map((u) => [u.templateId, Number(u.count)]));
			return rows.map((r) => ({ ...r.template, categoryName: r.categoryName, usedCount: used.get(r.template.id) ?? 0 }));
		},

		async duplicate(actor: Actor, id: string): Promise<EmailTemplateRow> {
			const source = await get(actor, id);
			if (!source) throw new Error("Template not found.");
			return save(actor, {
				name: `${source.name} (copy)`,
				categoryId: source.categoryId,
				subject: source.subject,
				preheader: source.preheader,
				blocks: source.blocks,
			});
		},

		async setArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailTemplates).set({ archivedAt: archived ? new Date() : null }).where(eq(emailTemplates.id, id));
			await record(actor, archived ? "email:template_archive" : "email:template_restore", id);
		},
	};
}
