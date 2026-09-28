import { desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsEvents, eventMedia } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type MediaRecord = InferSelectModel<typeof eventMedia>;
export type AddMediaInput = { eventId: string; r2Key: string; caption: string | null };

export type EventMediaRepository = {
	add(actor: Actor, input: AddMediaInput): Promise<MediaRecord>;
	listForEvent(actor: Actor, eventId: string): Promise<MediaRecord[]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function createEventMediaRepository(db: Db, audit: AuditRepository): EventMediaRepository {
	return {
		async add(actor, input) {
			if (!can(actor, "event:moderate")) throw new Error("Not authorized to add event media.");
			if (!input.r2Key.startsWith(`events/${input.eventId}/`)) throw new Error("Media key does not belong to this event.");
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, input.eventId)).limit(1);
			if (!event || event.deletedAt) throw new Error("Event not found.");
			// Informational events take no member contributions. Existing media stays readable.
			if (event.readOnly) throw new Error("This event does not accept uploads.");
			const [media] = await db
				.insert(eventMedia)
				.values({
					id: createId("media"),
					eventId: input.eventId,
					r2Key: input.r2Key,
					caption: input.caption,
					uploadedBy: actor.memberId,
				})
				.returning();
			await audit.record(actor, { action: "event:add_media", targetType: "event", targetId: input.eventId, category: "event" });
			return media;
		},
		async listForEvent(actor, eventId) {
			if (!actor) throw new Error("Authentication required.");
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
			if (!event || event.deletedAt) throw new Error("Event not found.");
			return db.select().from(eventMedia).where(eq(eventMedia.eventId, eventId)).orderBy(desc(eventMedia.createdAt)).limit(100);
		},
	};
}
