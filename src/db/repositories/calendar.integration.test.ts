import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createCalendarRepository } from "./calendar";

const memberActor: Actor = { memberId: "mem_view", roles: ["member"] };
const adminActor: Actor = { memberId: "mem_admin", roles: ["super"] };

function db() {
	return drizzle(env.DB, { schema });
}

describe("calendar repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_media", "crs_attendance", "event_rsvps", "crs_events", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		// Seeded by migration 0010/0012 and never deleted here, so restore the colour a test may change.
		await env.DB.prepare("UPDATE event_type_rules SET colour = ? WHERE type = ?").bind("accent", "birthday").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_view", "view@example.com", "Viewer", "1990-06-10", 1)
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_public_bday", "pub@example.com", "Public Bday", "2000-06-15", 0)
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "1995-06-20", 1)
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", 20, 10, Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 30))
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_in", "Approved June Event", "official", "approved", "SOM 111", Date.UTC(2026, 5, 12, 9), "desc", "mem_admin", "s1")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_pending", "Pending Event", "official", "pending", "SOM 112", Date.UTC(2026, 5, 13, 9), "desc", "mem_admin", "s2")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_out", "July Event", "official", "approved", "SOM 113", Date.UTC(2026, 6, 2, 9), "desc", "mem_admin", "s3")
			.run();
	});

	it("includes non-deleted in-window events and excludes out-of-window ones", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		const eventIds = items.filter((i) => i.source === "event").map((i) => i.eventId);
		expect(eventIds).toContain("evt_in");
		expect(eventIds).toContain("evt_pending");
		expect(eventIds).not.toContain("evt_out");
	});

	it("includes a public birthday but hides a private one from a normal member", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		const birthdayTitles = items.filter((i) => i.source === "birthday").map((i) => i.title);
		expect(birthdayTitles.some((t) => t.includes("Public Bday"))).toBe(true);
		expect(birthdayTitles.some((t) => t.includes("Viewer"))).toBe(false);
	});

	it("colours birthdays from the admin-managed birthday event type", async () => {
		await env.DB.prepare("UPDATE event_type_rules SET colour = ? WHERE type = ?").bind("rose", "birthday").run();
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		const birthday = items.find((i) => i.source === "birthday");
		expect(birthday?.colour).toBe("rose");
	});

	it("reveals private birthdays to an actor with member:manage", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(adminActor, { year: 2026, month: 6 });
		const birthdayTitles = items.filter((i) => i.source === "birthday").map((i) => i.title);
		expect(birthdayTitles.some((t) => t.includes("Viewer"))).toBe(true);
	});

	it("includes a term deadline that falls inside the window", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		expect(items.some((i) => i.source === "term_deadline")).toBe(true);
	});

	it("returns event detail with my rsvp, attendance count, and a links-to href", async () => {
		await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state) VALUES (?, ?, ?)")
			.bind("evt_in", "mem_view", "going")
			.run();
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
			.bind("evt_in", "mem_view", Date.UTC(2026, 5, 12, 10), "mem_admin")
			.run();
		const repo = createCalendarRepository(db());
		const detail = await repo.getEvent(memberActor, "evt_in");
		expect(detail?.myRsvp).toBe("going");
		expect(detail?.attendingCount).toBe(1);
		expect(detail?.iAttended).toBe(true);
	});

	it("returns null event detail for a deleted event", async () => {
		await env.DB.prepare("UPDATE crs_events SET deleted_at = ? WHERE id = ?").bind(Date.now(), "evt_pending").run();
		const repo = createCalendarRepository(db());
		expect(await repo.getEvent(memberActor, "evt_pending")).toBeNull();
	});
});
