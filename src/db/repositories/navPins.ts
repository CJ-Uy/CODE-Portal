import { asc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { navPins } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type NavPin = InferSelectModel<typeof navPins>;
type NavPinInsert = InferInsertModel<typeof navPins>;

export type NavPinInput = {
	label: string;
	url: string;
	icon: string;
	position: number;
};

export type NavPinDb = {
	select(): {
		from(table: typeof navPins): {
			orderBy(column: unknown): Promise<NavPin[]> | NavPin[];
		};
	};
	insert(table: typeof navPins): { values(value: NavPinInsert): { returning(): Promise<NavPin[]> | NavPin[] } };
	update(table: typeof navPins): {
		set(value: Partial<NavPinInsert>): { where(condition: unknown): { returning(): Promise<NavPin[]> | NavPin[] } };
	};
	delete(table: typeof navPins): { where(condition: unknown): Promise<unknown> | { then: Promise<unknown>["then"] } };
};

export type NavPinsRepository = {
	list(actor: Actor): Promise<NavPin[]>;
	listVisible(actor: Actor): Promise<NavPin[]>;
	create(actor: Actor, input: NavPinInput): Promise<NavPin>;
	update(actor: Actor, id: string, input: NavPinInput): Promise<NavPin>;
	remove(actor: Actor, id: string): Promise<void>;
};

export function createNavPinsRepository(db: NavPinDb, audit: AuditRepository): NavPinsRepository {
	return {
		async list(actor) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to list nav pins.");
			}
			return db.select().from(navPins).orderBy(asc(navPins.position));
		},
		async listVisible() {
			return db.select().from(navPins).orderBy(asc(navPins.position));
		},
		async create(actor, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to create nav pins.");
			}
			const [pin] = await db
				.insert(navPins)
				.values({ id: createId("nav"), ...input, createdBy: actor.memberId })
				.returning();
			await audit.record(actor, {
				action: "nav_pin:create",
				targetType: "nav_pin",
				targetId: pin.id,
				category: "member",
			});
			return pin;
		},
		async update(actor, id, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to update nav pins.");
			}
			const [pin] = await db
				.update(navPins)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(navPins.id, id))
				.returning();
			if (!pin) throw new Error("Nav pin not found.");
			await audit.record(actor, {
				action: "nav_pin:update",
				targetType: "nav_pin",
				targetId: pin.id,
				category: "member",
			});
			return pin;
		},
		async remove(actor, id) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to remove nav pins.");
			}
			await db.delete(navPins).where(eq(navPins.id, id));
			await audit.record(actor, {
				action: "nav_pin:delete",
				targetType: "nav_pin",
				targetId: id,
				category: "member",
			});
		},
	};
}
