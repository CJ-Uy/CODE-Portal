import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { debriefInputSchema } from "@/db/types";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventDebriefsRepository } from "./event-debriefs";

const db = drizzle(env.DB, { schema });
const debriefs = createEventDebriefsRepository(db, createAuditRepository(db));

const crs: Actor = { memberId: "mem_crs", roles: ["retention"] };
const owner: Actor = { memberId: "mem_owner", roles: ["member"] };
const staffAdmin: Actor = { memberId: "mem_staff", roles: ["member"] };
const scanner: Actor = { memberId: "mem_scan", roles: ["member"] };
const stranger: Actor = { memberId: "mem_other", roles: ["member"] };

const fields = { intended: "Teach SQL", happened: "Taught joins", why: "Ran out of time", change: "Start earlier" };

describe("event debriefs on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_debriefs", "event_staff", "crs_events", "audit_logs", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_crs", "mem_owner", "mem_staff", "mem_scan", "mem_other"]) {
			await db.insert(schema.members).values({ id, email: `${id}@example.com`, name: id, status: "active" });
		}
		await db.insert(schema.crsEvents).values({
			id: "evt_1",
			title: "Study Jam",
			type: "workshop",
			status: "approved",
			place: "Room",
			startsAt: new Date(0),
			description: "Test event",
			createdBy: "mem_owner",
			checkinSecret: "secret",
		});
		await db.insert(schema.eventStaff).values([
			{ eventId: "evt_1", memberId: "mem_staff", role: "admin" },
			{ eventId: "evt_1", memberId: "mem_scan", role: "scanner" },
		]);
	});

	it("lets the owner and staff admins save, but not scanners", async () => {
		expect(await debriefs.canEdit(owner, "evt_1")).toBe(true);
		expect(await debriefs.canEdit(staffAdmin, "evt_1")).toBe(true);
		expect(await debriefs.canEdit(scanner, "evt_1")).toBe(false);
		expect(await debriefs.canEdit(stranger, "evt_1")).toBe(false);

		const saved = await debriefs.save(owner, { eventId: "evt_1", ...fields });
		expect(saved).toMatchObject({ eventId: "evt_1", updatedBy: "mem_owner", ...fields });
		await expect(debriefs.save(staffAdmin, { eventId: "evt_1", intended: "Edited" })).resolves.toMatchObject({
			intended: "Edited",
			updatedBy: "mem_staff",
		});

		await expect(debriefs.save(scanner, { eventId: "evt_1", ...fields })).rejects.toThrow("Not authorized");
		await expect(debriefs.get(scanner, "evt_1")).rejects.toThrow("Not authorized");
		await expect(debriefs.get(stranger, "evt_1")).rejects.toThrow("Not authorized");
	});

	it("lets CRS save any debrief and upserts", async () => {
		expect(await debriefs.canEdit(crs, "evt_1")).toBe(true);
		expect(await debriefs.get(crs, "evt_1")).toBeNull();

		await debriefs.save(crs, { eventId: "evt_1", ...fields });
		await debriefs.save(crs, { eventId: "evt_1", intended: "Teach Python", happened: null, why: "Because", change: "Nothing" });

		const rows = await db.select().from(schema.eventDebriefs);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ intended: "Teach Python", happened: null, why: "Because", change: "Nothing", updatedBy: "mem_crs" });

		const [first, second] = await db.select().from(schema.auditLogs);
		expect([first, second]).toEqual([
			expect.objectContaining({ action: "event:debrief_save", category: "survey", targetType: "event", targetId: "evt_1" }),
			expect.objectContaining({ action: "event:debrief_save", category: "survey", targetType: "event", targetId: "evt_1" }),
		]);
	});

	it("reads the debrief with the name of whoever last saved it", async () => {
		await debriefs.save(owner, { eventId: "evt_1", ...fields });
		await db.update(schema.members).set({ fullName: "Olive Owner" }).where(eq(schema.members.id, "mem_owner"));

		expect(await debriefs.get(owner, "evt_1")).toMatchObject({ ...fields, updatedByName: "Olive Owner" });
		expect(await debriefs.get(crs, "evt_1")).toMatchObject({ updatedBy: "mem_owner" });
	});

	it("keeps fields that a later save leaves out", async () => {
		await debriefs.save(owner, { eventId: "evt_1", ...fields });
		await debriefs.save(owner, { eventId: "evt_1", why: null });

		expect(await debriefs.get(owner, "evt_1")).toMatchObject({ intended: "Teach SQL", why: null, change: "Start earlier" });
	});

	it("treats a deleted or unknown event as not found", async () => {
		await env.DB.prepare("UPDATE crs_events SET deleted_at = 1 WHERE id = 'evt_1'").run();

		await expect(debriefs.save(crs, { eventId: "evt_1", ...fields })).rejects.toThrow("Event not found.");
		await expect(debriefs.save(crs, { eventId: "evt_none", ...fields })).rejects.toThrow("Event not found.");
		expect(await db.select().from(schema.eventDebriefs)).toHaveLength(0);
	});

	it("trims debrief text, turns empty into null, and caps it at 2000 characters", () => {
		expect(debriefInputSchema.parse({ eventId: " evt_1 ", intended: "  Plan  ", happened: "   ", why: "", change: "x".repeat(2000) })).toEqual({
			eventId: "evt_1",
			intended: "Plan",
			happened: null,
			why: null,
			change: "x".repeat(2000),
		});
		expect(debriefInputSchema.parse({ eventId: "evt_1" })).toEqual({ eventId: "evt_1" });
		expect(debriefInputSchema.safeParse({ eventId: "evt_1", why: "x".repeat(2001) }).success).toBe(false);
	});
});
