import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import {
	allowedEventTypes,
	canCreateType,
	createEventTypeRulesRepository,
	labelFor,
	type EventTypeRow,
} from "./eventTypeRules";

const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };
const eventsAdmin: Actor = { memberId: "mem_events", roles: ["events"] };
const superAdmin: Actor = { memberId: "mem_super", roles: ["super"] };

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return createEventTypeRulesRepository(db, createAuditRepository(db));
}

describe("event type rules on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		for (const [id, email] of [
			["mem_plain", "plain@example.com"],
			["mem_events", "events@example.com"],
			["mem_super", "super@example.com"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email) VALUES (?, ?)").bind(id, email).run();
		}
		await env.DB.prepare("DELETE FROM event_type_rules").run();
		for (const [type, permission, label, colour, position] of [
			["official", "event:create_restricted", "Official", "primary", 0],
			["casual", null, "Casual", "emerald", 1],
			["birthday", null, "Birthday", "accent", 2],
		] as const) {
			await env.DB.prepare(
				"INSERT INTO event_type_rules (type, required_permission, label, colour, active, position) VALUES (?, ?, ?, ?, 1, ?)",
			)
				.bind(type, permission, label, colour, position)
				.run();
		}
	});

	it("returns full type rows ordered by position", async () => {
		const rows: EventTypeRow[] = await makeRepo().list();
		expect(rows.map((r) => r.type)).toEqual(["official", "casual", "birthday"]);
		expect(rows[0]).toMatchObject({ type: "official", label: "Official", colour: "primary", active: true });
	});

	it("FAILS CLOSED when no row exists for the key", async () => {
		// Once the table IS the type list, a missing row means the type does not exist.
		// This reverses the previous behaviour, where a missing row meant "no rule configured".
		const rows = await makeRepo().list();
		expect(canCreateType(superAdmin, rows, "does_not_exist")).toBe(false);
		expect(canCreateType(plainMember, rows, "does_not_exist")).toBe(false);
	});

	it("rejects an inactive type for everyone, including super", async () => {
		const repo = makeRepo();
		await repo.upsertType(superAdmin, {
			type: "casual", label: "Casual", colour: "emerald",
			requiredPermission: null, active: false, position: 1,
		});
		const rows = await repo.list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(false);
		expect(canCreateType(superAdmin, rows, "casual")).toBe(false);
		expect(allowedEventTypes(plainMember, rows).map((r) => r.type)).not.toContain("casual");
	});

	it("gates active types by permission", async () => {
		const rows = await makeRepo().list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(true);
		expect(canCreateType(plainMember, rows, "official")).toBe(false);
		expect(canCreateType(eventsAdmin, rows, "official")).toBe(true);
		expect(canCreateType(superAdmin, rows, "official")).toBe(true);
	});

	it("still fails closed on an unrecognized permission string", async () => {
		await env.DB.prepare("UPDATE event_type_rules SET required_permission = ? WHERE type = ?")
			.bind("event:create_restrictedd", "casual")
			.run();
		const rows = await makeRepo().list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(false);
		expect(canCreateType(eventsAdmin, rows, "casual")).toBe(false);
		expect(canCreateType(superAdmin, rows, "casual")).toBe(true);
	});

	it("creates a brand new admin-defined type", async () => {
		const repo = makeRepo();
		await repo.upsertType(superAdmin, {
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		});
		const rows = await repo.list();
		expect(rows.find((r) => r.type === "workshop")).toMatchObject({ label: "Workshop", colour: "amber", active: true });
		expect(canCreateType(plainMember, rows, "workshop")).toBe(true);
	});

	it("rejects an unknown colour token and a malformed key", async () => {
		const repo = makeRepo();
		const base = { label: "X", colour: "amber", requiredPermission: null, active: true, position: 9 };
		await expect(repo.upsertType(superAdmin, { ...base, type: "workshop", colour: "chartreuse" })).rejects.toThrow(
			"Unknown colour",
		);
		await expect(repo.upsertType(superAdmin, { ...base, type: "Not A Key!" })).rejects.toThrow("Invalid event type key");
	});

	it("rejects writes from an actor without role:assign", async () => {
		const base = {
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		};
		await expect(makeRepo().upsertType(plainMember, base)).rejects.toThrow("Not authorized");
		await expect(makeRepo().setRequiredPermission(plainMember, "casual", null)).rejects.toThrow("Not authorized");
	});

	it("resolves a label, falling back to the key when the row is gone", async () => {
		const rows = await makeRepo().list();
		expect(labelFor(rows, "official")).toBe("Official");
		expect(labelFor(rows, "vanished")).toBe("vanished");
	});
});
