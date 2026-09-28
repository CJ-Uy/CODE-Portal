import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createOverviewRepository } from "./overview";

const NOW = new Date("2026-06-18T00:00:00.000Z");
const memberActor: Actor = { memberId: "mem_ov", roles: ["member"] };

describe("overview repository on D1", () => {
	beforeEach(async () => {
		for (const table of [
			"retention_records",
			"survey_assignments",
			"surveys",
			"link_daily_stats",
			"short_links",
			"crs_events",
			"term_member_roster",
			"terms",
			"point_types",
			"members",
		]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_ov", "ov@example.com", "Overview Member", "active")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "active")
			.run();
		await env.DB.prepare(`
			INSERT INTO point_types
				(id, key, label, active, position, updated_by)
			VALUES
				('pt_retention', 'retention', 'Retention', 1, 0, 'mem_admin'),
				('pt_frontliner', 'frontliner', 'Frontliner', 1, 1, 'mem_admin')
		`).run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_now", "Term 1", 20, 10, NOW.getTime() - 1000, NOW.getTime() + 1000 * 60 * 60 * 24 * 60)
			.run();
	});

	it("sums this term's retention points, counts pending surveys, upcoming events, and owned-link clicks", async () => {
		await env.DB.prepare(`
			INSERT INTO retention_records
				(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.bind("ret_keep", "mem_ov", "term_now", "pt_retention", 8, "Retention", "manual", "mem_admin", NOW.getTime())
			.run();
		await env.DB.prepare(`
			INSERT INTO retention_records
				(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.bind("ret_ignore", "mem_ov", "term_now", "pt_frontliner", 50, "Frontliner", "manual", "mem_admin", NOW.getTime())
			.run();
		await env.DB.prepare("INSERT INTO surveys (id, title, status, created_by) VALUES (?, ?, ?, ?)")
			.bind("srv_1", "Feedback", "running", "mem_admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO survey_assignments (survey_id, member_id, response_token_hash, completed_at) VALUES (?, ?, ?, ?)",
		)
			.bind("srv_1", "mem_ov", "hash_pending", null)
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_up", "Upcoming", "official", "approved", "SOM", NOW.getTime() + 1000 * 60 * 60 * 24, "Soon", "mem_admin", "s1")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_past", "Past", "official", "approved", "SOM", NOW.getTime() - 1000 * 60 * 60 * 24, "Old", "mem_admin", "s2")
			.run();
		await env.DB.prepare(
			"INSERT INTO short_links (id, slug, destination_url, title, owner_member_id, click_count) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("lnk_1", "mine", "https://example.com", "Mine", "mem_ov", 0)
			.run();
		await env.DB.prepare(
			"INSERT INTO link_daily_stats (link_id, date, referrer_bucket, device_bucket, count) VALUES (?, ?, ?, ?, ?)",
		)
			.bind("lnk_1", "2026-06-18", "direct", "desktop", 12)
			.run();

		const db = drizzle(env.DB, { schema });
		const repository = createOverviewRepository(db);
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary.retention).toMatchObject({ points: 8, retainedAt: 20, termName: "Term 1" });
		expect(summary.pendingSurveys).toBe(1);
		expect(summary.upcomingEvents).toBe(1);
		expect(summary.linkClicks).toBe(12);
	});

	it("returns zeroed counts and a null term when the member has no activity and no active term", async () => {
		await env.DB.prepare("DELETE FROM terms").run();
		const db = drizzle(env.DB, { schema });
		const repository = createOverviewRepository(db);
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary).toEqual({
			retention: { points: 0, retainedAt: null, termName: null },
			pendingSurveys: 0,
			upcomingEvents: 0,
			linkClicks: 0,
		});
	});

	it("quantizes fractional retention totals", async () => {
		for (const [id, points] of [["ret_fraction_a", 0.1], ["ret_fraction_b", 0.2]] as const) {
			await env.DB.prepare(`
				INSERT INTO retention_records
					(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
				.bind(id, "mem_ov", "term_now", "pt_retention", points, id, "manual", "mem_admin", NOW.getTime())
				.run();
		}

		const repository = createOverviewRepository(drizzle(env.DB, { schema }));
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary.retention.points).toBe(0.3);
	});
});
