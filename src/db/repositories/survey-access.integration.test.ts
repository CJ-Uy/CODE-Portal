import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { eligibleMemberIds, eventRole, isOrganizerRole, staffIds } from "./survey-access";

const db = drizzle(env.DB, { schema });

async function addMember(id: string, status = "active") {
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind(id, `${id}@example.com`, id, status)
		.run();
}

async function attend(eventId: string, memberId: string) {
	await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
		.bind(eventId, memberId, 0, "mem_owner")
		.run();
}

describe("survey access on D1", () => {
	beforeEach(async () => {
		for (const table of ["crs_attendance", "event_staff", "surveys", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_owner", "mem_scan", "mem_adm", "mem_a", "mem_b"]) await addMember(id);
		await addMember("mem_gone", "inactive");
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "Study Jam", "official", "approved", "Room", 0, "Test event", "mem_owner", "secret")
			.run();
		await env.DB.prepare("INSERT INTO event_staff (event_id, member_id, role) VALUES (?, ?, ?)")
			.bind("evt_1", "mem_scan", "scanner")
			.run();
		await env.DB.prepare("INSERT INTO event_staff (event_id, member_id, role) VALUES (?, ?, ?)")
			.bind("evt_1", "mem_adm", "admin")
			.run();
	});

	it("excludes the owner and all staff from eligibility", async () => {
		for (const id of ["mem_owner", "mem_scan", "mem_adm", "mem_b", "mem_a"]) await attend("evt_1", id);

		expect(await eligibleMemberIds(db, { eventId: "evt_1" })).toEqual(["mem_a", "mem_b"]);
		expect(await eventRole(db, "evt_1", "mem_owner")).toBe("owner");
		expect(await eventRole(db, "evt_1", "mem_adm")).toBe("admin");
		expect(await eventRole(db, "evt_1", "mem_scan")).toBe("scanner");
		expect(await eventRole(db, "evt_1", "mem_a")).toBeNull();
		expect(await eventRole(db, "evt_none", "mem_a")).toBeNull();
	});

	it("counts only active members who actually attended", async () => {
		await attend("evt_1", "mem_a");
		await attend("evt_1", "mem_gone");

		expect(await eligibleMemberIds(db, { eventId: "evt_1" })).toEqual(["mem_a"]);
		expect(await eligibleMemberIds(db, { eventId: "evt_none" })).toEqual([]);
	});

	it("makes every active member eligible for a general form", async () => {
		expect(await eligibleMemberIds(db, { eventId: null })).toEqual(["mem_a", "mem_adm", "mem_b", "mem_owner", "mem_scan"]);
	});

	it("lists the owner plus every staff member, and treats only the owner and admins as organizers", async () => {
		expect([...(await staffIds(db, "evt_1"))].sort()).toEqual(["mem_adm", "mem_owner", "mem_scan"]);
		expect(isOrganizerRole("owner")).toBe(true);
		expect(isOrganizerRole("admin")).toBe(true);
		expect(isOrganizerRole("scanner")).toBe(false);
		expect(isOrganizerRole(null)).toBe(false);
	});
});
