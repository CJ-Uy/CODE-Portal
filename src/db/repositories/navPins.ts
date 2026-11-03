import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { navPins } from "@/db/schema";
import { createId } from "@/lib/ids";
import { can, type Actor } from "@/server/auth/permissions";
import type * as schema from "../schema";
import type { AuditRepository } from "./audit";

export type NavPin = InferSelectModel<typeof navPins>;
export type NavPinInput = Pick<NavPin, "label" | "url" | "icon" | "position">;
export type NavPinsRepository = {
	list(actor: Actor): Promise<NavPin[]>;
	create(actor: Actor, input: NavPinInput): Promise<NavPin>;
	update(actor: Actor, id: string, input: NavPinInput): Promise<NavPin>;
	remove(actor: Actor, id: string): Promise<void>;
};

function assertConfigure(actor: Actor) {
	if (!can(actor, "nav:configure")) throw new Error("Not authorized to manage pinned nav links.");
}

export function createNavPinsRepository(db: DrizzleD1Database<typeof schema>, audit: AuditRepository): NavPinsRepository {
	async function record(actor: Actor, action: string, id: string) {
		await audit.record(actor, { action, targetType: "nav_pin", targetId: id, category: "member" });
	}
	return {
		async list() {
			return db.select().from(navPins).orderBy(asc(navPins.position), asc(navPins.createdAt), asc(navPins.id));
		},
		async create(actor, input) {
			assertConfigure(actor);
			const [pin] = await db.insert(navPins).values({ id: createId("nav"), ...input, createdBy: actor.memberId }).returning();
			await record(actor, "nav_pin:create", pin.id);
			return pin;
		},
		async update(actor, id, input) {
			assertConfigure(actor);
			const [pin] = await db.update(navPins).set({ ...input, updatedAt: new Date() }).where(eq(navPins.id, id)).returning();
			if (!pin) throw new Error("Pinned nav link not found.");
			await record(actor, "nav_pin:update", id);
			return pin;
		},
		async remove(actor, id) {
			assertConfigure(actor);
			const [pin] = await db.delete(navPins).where(eq(navPins.id, id)).returning({ id: navPins.id });
			if (!pin) throw new Error("Pinned nav link not found.");
			await record(actor, "nav_pin:delete", id);
		},
	};
}
