import { asc, eq, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { emailCategories, emailSenders } from "@/db/schema";
import { createId } from "@/lib/ids";
import { isSendingAddress, SENDING_DOMAIN } from "@/server/email/config";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { assertEmail } from "./email-guard";
import type { EmailDb } from "./email-audience";

export type EmailSenderRow = InferSelectModel<typeof emailSenders>;
export type EmailCategoryRow = InferSelectModel<typeof emailCategories>;

export function createEmailSettingsRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetType: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType, targetId, category: "email", detail: detail ?? null });

	async function orderedCategories(includeArchived: boolean) {
		return db
			.select()
			.from(emailCategories)
			.where(includeArchived ? undefined : isNull(emailCategories.archivedAt))
			.orderBy(asc(emailCategories.sortOrder), asc(emailCategories.name));
	}

	return {
		async listSenders(actor: Actor, opts?: { includeArchived?: boolean }): Promise<EmailSenderRow[]> {
			assertEmail(actor, "email:send");
			return db
				.select()
				.from(emailSenders)
				.where(opts?.includeArchived ? undefined : isNull(emailSenders.archivedAt))
				.orderBy(asc(emailSenders.displayName));
		},

		async saveSender(actor: Actor, input: { id?: string; address: string; displayName: string }): Promise<EmailSenderRow> {
			assertEmail(actor, "email:configure");
			const address = input.address.trim().toLowerCase();
			const displayName = input.displayName.trim();
			if (!isSendingAddress(address)) throw new Error(`Sender addresses must end in @${SENDING_DOMAIN}.`);
			if (!z.string().email().safeParse(address).success) throw new Error("Enter a valid sender address.");
			if (!displayName) throw new Error("Add a display name.");
			const [clash] = await db.select({ id: emailSenders.id }).from(emailSenders).where(eq(emailSenders.address, address)).limit(1);
			if (clash && clash.id !== input.id) throw new Error("That address is already a sender.");
			const [row] = input.id
				? await db.update(emailSenders).set({ address, displayName }).where(eq(emailSenders.id, input.id)).returning()
				: await db.insert(emailSenders).values({ id: createId("esnd"), address, displayName }).returning();
			if (!row) throw new Error("Sender not found.");
			await record(actor, input.id ? "email:sender_update" : "email:sender_create", "email_sender", row.id, address);
			return row;
		},

		async setSenderArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailSenders).set({ archivedAt: archived ? new Date() : null }).where(eq(emailSenders.id, id));
			await record(actor, archived ? "email:sender_archive" : "email:sender_restore", "email_sender", id);
		},

		async listCategories(actor: Actor, opts?: { includeArchived?: boolean }): Promise<EmailCategoryRow[]> {
			assertEmail(actor, "email:send");
			return orderedCategories(Boolean(opts?.includeArchived));
		},

		async saveCategory(
			actor: Actor,
			input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null },
		): Promise<EmailCategoryRow> {
			assertEmail(actor, "email:configure");
			const name = input.name.trim();
			if (!name) throw new Error("Add a category name.");
			const values = { name, description: input.description.trim(), required: input.required, defaultSenderId: input.defaultSenderId };
			let row: EmailCategoryRow | undefined;
			if (input.id) {
				[row] = await db.update(emailCategories).set(values).where(eq(emailCategories.id, input.id)).returning();
			} else {
				const existing = await orderedCategories(true);
				const sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
				[row] = await db.insert(emailCategories).values({ id: createId("ecat"), ...values, sortOrder }).returning();
			}
			if (!row) throw new Error("Category not found.");
			await record(actor, input.id ? "email:category_update" : "email:category_create", "email_category", row.id, `${name} (${input.required ? "required" : "optional"})`);
			return row;
		},

		async setCategoryArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailCategories).set({ archivedAt: archived ? new Date() : null }).where(eq(emailCategories.id, id));
			await record(actor, archived ? "email:category_archive" : "email:category_restore", "email_category", id);
		},

		async moveCategory(actor: Actor, id: string, direction: "up" | "down"): Promise<void> {
			assertEmail(actor, "email:configure");
			const list = await orderedCategories(false);
			const index = list.findIndex((c) => c.id === id);
			const swapWith = direction === "up" ? index - 1 : index + 1;
			if (index < 0 || swapWith < 0 || swapWith >= list.length) return;
			const reordered = [...list];
			[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
			for (const [position, category] of reordered.entries()) {
				await db.update(emailCategories).set({ sortOrder: position }).where(eq(emailCategories.id, category.id));
			}
		},
	};
}
