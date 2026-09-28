import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventsRepository } from "./events";

// event:moderate is held by the events role and by super; a plain member never has it.
const eventsAdmin: Actor = { memberId: "mem_events", roles: ["events"] };
const owner: Actor = { memberId: "mem_owner", roles: ["member"] };

const START = new Date("2026-07-10T10:00:00.000Z");
const END = new Date("2026-07-10T12:00:00.000Z");

function makeRepos() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createEventsRepository(db, createAuditRepository(db)) };
}

describe("read-only events on D1", () => {
	beforeEach(async () => {
		for (const table of [
			"audit_logs",
			"crs_attendance",
			"event_point_awards",
			"event_invites",
			"event_staff",
			"event_rsvps",
			"event_type_rules",
			"crs_events",
			"terms",
			"members",
		]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const [id, email, name] of [
			["mem_owner", "owner@example.com", "Owner"],
			["mem_events", "events@example.com", "Events Admin"],
			["mem_a", "a@example.com", "Member A"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
				.bind(id, email, name, name)
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO event_type_rules (type, required_permission, label, colour, active, position) VALUES (?, ?, ?, ?, 1, ?)",
		)
			.bind("casual", null, "Casual", "emerald", 0)
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", 20, 10, new Date("2026-06-01").getTime(), new Date("2026-10-31").getTime())
			.run();
	});

	function base(extra: Record<string, unknown> = {}) {
		return {
			title: "Finals week",
			type: "casual",
			place: "Campus",
			description: "No classes",
			startsAt: START,
			endsAt: END,
			capacity: null,
			...extra,
		} as Parameters<ReturnType<typeof makeRepos>["repo"]["create"]>[1];
	}

	it("refuses to create a read-only event without event:moderate", async () => {
		const { repo } = makeRepos();
		await expect(repo.create(owner, base({ readOnly: true }))).rejects.toThrow(/not authorized/i);
	});

	it("lets an event:moderate holder create one", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(eventsAdmin, base({ readOnly: true }));
		expect(event.readOnly).toBe(true);
	});

	it("clears interaction settings on a read-only event", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(
			eventsAdmin,
			base({ readOnly: true, capacity: 50, graceMinutes: 30, rsvpResponsesPublic: true }),
		);
		expect(event.capacity).toBeNull();
		expect(event.graceMinutes).toBeNull();
		expect(event.rsvpResponsesPublic).toBe(false);
		expect(event.points).toBeNull();
	});

	// The finding that mattered: canManage() is true for the OWNER, so gating the flag on canManage
	// alone would let any member strip their own event's signup surface.
	it("refuses to let a plain owner flip their own event read-only", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, base());
		await expect(repo.update(owner, event.id, { readOnly: true })).rejects.toThrow(/not authorized/i);
	});

	it("lets an event:moderate holder flip an existing event and back", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, base());

		const flipped = await repo.update(eventsAdmin, event.id, { readOnly: true });
		expect(flipped.readOnly).toBe(true);

		const restored = await repo.update(eventsAdmin, event.id, { readOnly: false });
		expect(restored.readOnly).toBe(false);
	});

	it("keeps collected signups when an event is flipped read-only", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, base());
		await repo.setRsvp({ memberId: "mem_a", roles: ["member"] }, { eventId: event.id, state: "going" });

		await repo.update(eventsAdmin, event.id, { readOnly: true });

		// Preserved, not deleted: a mistaken flip has to be reversible without data loss.
		const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ?").bind(event.id).all();
		expect((rows.results[0] as { n: number }).n).toBe(1);
	});

	it("blocks every member-facing mutation on a read-only event", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(eventsAdmin, base({ readOnly: true }));
		const member: Actor = { memberId: "mem_a", roles: ["member"] };

		await expect(repo.setRsvp(member, { eventId: event.id, state: "going" })).rejects.toThrow(/does not take signups/i);
		await expect(
			repo.recordScan(eventsAdmin, { eventId: event.id, memberId: "mem_a", termId: "term_1" }),
		).rejects.toThrow(/does not take check-ins/i);
		await expect(repo.undoScan(eventsAdmin, { eventId: event.id, memberId: "mem_a" })).rejects.toThrow(
			/does not take check-ins/i,
		);
		await expect(repo.invite(eventsAdmin, event.id, ["mem_a"])).rejects.toThrow(/does not take signups/i);
	});

	it("returns no attendable members for a read-only event instead of erroring per keystroke", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(eventsAdmin, base({ readOnly: true }));
		await expect(repo.searchAttendableMembers(eventsAdmin, { eventId: event.id, query: "a" })).resolves.toEqual([]);
	});

	it("still allows organizer administration on a read-only event", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(eventsAdmin, base({ readOnly: true }));
		// Editing, staffing and deleting are unaffected — read-only is about member interaction.
		await expect(repo.update(eventsAdmin, event.id, { title: "Finals week (revised)" })).resolves.toMatchObject({
			title: "Finals week (revised)",
		});
		await expect(repo.listAttendance(eventsAdmin, event.id)).resolves.toEqual([]);
	});

	it("allocates a distinct share code per event", async () => {
		const { repo } = makeRepos();
		const first = await repo.create(owner, base());
		const second = await repo.create(owner, base());
		expect(first.publicCode).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/);
		expect(first.publicCode).not.toBe(second.publicCode);
	});

	it("resolves a share code case-insensitively and refuses a bad one", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, base());
		const code = event.publicCode as string;

		await expect(repo.resolveShareCode(code.toLowerCase())).resolves.toEqual({ id: event.id });
		await expect(repo.resolveShareCode("NOPE!!")).resolves.toBeNull();
		await expect(repo.resolveShareCode("ZZZZZZ")).resolves.toBeNull();
	});

	it("stops resolving a share code once the event is soft-deleted", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, base());
		await repo.softDelete(owner, event.id);
		await expect(repo.resolveShareCode(event.publicCode as string)).resolves.toBeNull();
	});
});
