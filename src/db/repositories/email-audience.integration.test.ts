import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Audience } from "@/lib/email/types";
import { resolveAudience } from "./email-audience";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-02T04:00:00Z");

async function member(id: string, batch: string, status = "active") {
	await env.DB.prepare("INSERT INTO members (id, email, name, batch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, `${id}@example.com`, id, batch, status, Date.now(), Date.now())
		.run();
}

const ids = async (audience: Audience) => (await resolveAudience(db, audience, NOW)).map((r) => r.memberId);

describe("resolveAudience", () => {
	beforeEach(async () => {
		for (const table of ["crs_attendance", "event_rsvps", "crs_events", "term_member_roster", "terms", "member_roles", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await member("mem_a", "2026");
		await member("mem_b", "2027");
		await member("mem_c", "2027");
		await member("mem_off", "2027", "inactive");
		// role_email is seeded by migration 0007.
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES ('mem_a', 'role_email', ?)").bind(Date.now()).run();
		await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES ('term_now', 'Now', 10, 5, ?, ?)")
			.bind(Date.parse("2026-08-01T00:00:00Z"), Date.parse("2027-05-31T00:00:00Z"))
			.run();
		for (const id of ["mem_a", "mem_b", "mem_off"]) {
			await env.DB.prepare("INSERT INTO term_member_roster (term_id, email, member_id, added_by, added_at) VALUES ('term_now', ?, ?, 'mem_a', ?)")
				.bind(`${id}@example.com`, id, Date.now())
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt_1', 'GA', 'official', 'Room', ?, 'd', 'mem_a', 's')",
		)
			.bind(Date.parse("2026-09-20T01:00:00Z"))
			.run();
		for (const id of ["mem_b", "mem_c"]) {
			await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state, answers_json, updated_at) VALUES ('evt_1', ?, 'going', '{}', ?)")
				.bind(id, Date.now())
				.run();
		}
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES ('evt_1', 'mem_b', ?, 'mem_a')").bind(Date.now()).run();
	});

	it("resolves the current roster without inactive members", async () => {
		expect(await ids({ match: "any", include: [{ kind: "roster", termId: "current" }], exclude: [] })).toEqual(["mem_a", "mem_b"]);
	});

	it("unions with any and intersects with all", async () => {
		const rules = [
			{ kind: "batch", batch: "2027" },
			{ kind: "role", roleKey: "email" },
		] as const;
		expect(await ids({ match: "any", include: [...rules], exclude: [] })).toEqual(["mem_a", "mem_b", "mem_c"]);
		expect(await ids({ match: "all", include: [{ kind: "batch", batch: "2027" }, { kind: "roster", termId: "current" }], exclude: [] })).toEqual(["mem_b"]);
	});

	it("handles RSVP, attended, and no-show", async () => {
		const event = (relation: "rsvp" | "attended" | "no_show"): Audience => ({ match: "any", include: [{ kind: "event", eventId: "evt_1", relation }], exclude: [] });
		expect(await ids(event("rsvp"))).toEqual(["mem_b", "mem_c"]);
		expect(await ids(event("attended"))).toEqual(["mem_b"]);
		expect(await ids(event("no_show"))).toEqual(["mem_c"]);
	});

	it("always adds hand-picked members and always subtracts excludes", async () => {
		const audience: Audience = {
			match: "all",
			include: [{ kind: "batch", batch: "2027" }, { kind: "member", memberId: "mem_a" }],
			exclude: [{ kind: "member", memberId: "mem_c" }],
		};
		expect(await ids(audience)).toEqual(["mem_a", "mem_b"]);
	});

	it("includes inactive members only when asked explicitly", async () => {
		expect(await ids({ match: "any", include: [{ kind: "status", status: "inactive" }], exclude: [] })).toEqual(["mem_off"]);
		expect(await ids({ match: "any", include: [{ kind: "member", memberId: "mem_off" }], exclude: [] })).toEqual(["mem_off"]);
	});

	it("returns nothing for an empty include", async () => {
		expect(await ids({ match: "any", include: [], exclude: [] })).toEqual([]);
	});

	describe("typed addresses", () => {
		const resolve = async (audience: Audience) =>
			(await resolveAudience(db, audience, NOW)).map((r) => ({ memberId: r.memberId, email: r.email, external: r.external }));

		it("maps a member address to that member, even an inactive one", async () => {
			expect(await resolve({ match: "any", include: [{ kind: "emails", emails: ["mem_off@example.com"] }], exclude: [] })).toEqual([
				{ memberId: "mem_off", email: "mem_off@example.com", external: false },
			]);
		});

		it("matches member addresses case-insensitively", async () => {
			await env.DB.prepare("UPDATE members SET email = 'Mem_A@Example.com' WHERE id = 'mem_a'").run();
			expect(await ids({ match: "any", include: [{ kind: "emails", emails: ["mem_a@example.com"] }], exclude: [] })).toEqual(["mem_a"]);
		});

		it("resolves an unknown address to an outside recipient", async () => {
			const [guest] = await resolveAudience(db, { match: "any", include: [{ kind: "emails", emails: ["guest@outside.org"] }], exclude: [] }, NOW);
			expect(guest).toEqual({ memberId: null, email: "guest@outside.org", name: null, fullName: null, nickname: null, batch: null, external: true });
		});

		it("gives one recipient per address across typed rules and member rules", async () => {
			const audience: Audience = {
				match: "any",
				include: [
					{ kind: "emails", emails: ["mem_c@example.com", "guest@outside.org"] },
					{ kind: "emails", emails: ["mem_c@example.com", "guest@outside.org"] },
					{ kind: "member", memberId: "mem_c" },
				],
				exclude: [],
			};
			expect(await resolve(audience)).toEqual([
				{ memberId: null, email: "guest@outside.org", external: true },
				{ memberId: "mem_c", email: "mem_c@example.com", external: false },
			]);
		});

		it("excludes typed addresses for both members and outside recipients", async () => {
			const audience: Audience = {
				match: "any",
				include: [{ kind: "batch", batch: "2027" }, { kind: "emails", emails: ["guest@outside.org", "other@outside.org"] }],
				exclude: [{ kind: "emails", emails: ["mem_b@example.com", "guest@outside.org"] }],
			};
			expect((await resolve(audience)).map((r) => r.email)).toEqual(["mem_c@example.com", "other@outside.org"]);
		});

		it("always includes typed addresses with match all", async () => {
			const audience: Audience = {
				match: "all",
				include: [
					{ kind: "batch", batch: "2027" },
					{ kind: "roster", termId: "current" },
					{ kind: "emails", emails: ["mem_a@example.com", "guest@outside.org"] },
				],
				exclude: [],
			};
			expect((await resolve(audience)).map((r) => r.email)).toEqual(["guest@outside.org", "mem_a@example.com", "mem_b@example.com"]);
		});
	});
});
