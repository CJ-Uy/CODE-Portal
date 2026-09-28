import { asc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { quickLinks } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type QuickLink = InferSelectModel<typeof quickLinks>;
type QuickLinkInsert = InferInsertModel<typeof quickLinks>;

export type QuickLinkInput = {
	label: string;
	url: string;
	position: number;
};

export type QuickLinkDb = {
	select(): {
		from(table: typeof quickLinks): {
			orderBy(column: unknown): Promise<QuickLink[]> | QuickLink[];
		};
	};
	insert(table: typeof quickLinks): { values(value: QuickLinkInsert): { returning(): Promise<QuickLink[]> | QuickLink[] } };
	update(table: typeof quickLinks): {
		set(value: Partial<QuickLinkInsert>): { where(condition: unknown): { returning(): Promise<QuickLink[]> | QuickLink[] } };
	};
	delete(table: typeof quickLinks): { where(condition: unknown): Promise<unknown> | { then: Promise<unknown>["then"] } };
};

export type QuickLinksRepository = {
	list(actor: Actor): Promise<QuickLink[]>;
	create(actor: Actor, input: QuickLinkInput): Promise<QuickLink>;
	update(actor: Actor, id: string, input: QuickLinkInput): Promise<QuickLink>;
	remove(actor: Actor, id: string): Promise<void>;
};

export function createQuickLinksRepository(db: QuickLinkDb, audit: AuditRepository): QuickLinksRepository {
	return {
		async list(actor) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to list quick links.");
			}
			return db.select().from(quickLinks).orderBy(asc(quickLinks.position));
		},
		async create(actor, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to create quick links.");
			}
			const [link] = await db
				.insert(quickLinks)
				.values({ id: createId("qlk"), ...input, createdBy: actor.memberId })
				.returning();
			await audit.record(actor, {
				action: "quick_link:create",
				targetType: "quick_link",
				targetId: link.id,
				category: "member",
			});
			return link;
		},
		async update(actor, id, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to update quick links.");
			}
			const [link] = await db
				.update(quickLinks)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(quickLinks.id, id))
				.returning();
			if (!link) throw new Error("Quick link not found.");
			await audit.record(actor, {
				action: "quick_link:update",
				targetType: "quick_link",
				targetId: link.id,
				category: "member",
			});
			return link;
		},
		async remove(actor, id) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to remove quick links.");
			}
			await db.delete(quickLinks).where(eq(quickLinks.id, id));
			await audit.record(actor, {
				action: "quick_link:delete",
				targetType: "quick_link",
				targetId: id,
				category: "member",
			});
		},
	};
}
