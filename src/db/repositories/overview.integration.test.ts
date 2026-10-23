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
			"INSERT INTO point_types (id, key, label, retention_period, active, position) VALUES ('pt_ts', 'ts', 'Training Seminar', 'year', 1, 2), ('pt_gma', 'gma', 'General Membership Activity', 'semester', 1, 3)",
		).run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)",
		)
			.bind("term_now", "Term 1", NOW.getTime() - 1000, NOW.getTime() + 1000 * 60 * 60 * 24 * 60)
			.run();
	});

	it("reports retention parts met this school year, counts pending surveys, upcoming events, and owned-link clicks", async () => {
		await env.DB.prepare(`
			INSERT INTO retention_records
				(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.bind("ret_keep", "mem_ov", "term_now", "pt_ts", 1, "Training", "manual", "mem_admin", NOW.getTime())
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
		await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id, completed_at) VALUES (?, ?, ?)")
			.bind("srv_1", "mem_ov", null)
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

		// Training Seminar is met; Frontliner points never count toward retention.
		expect(summary.retention).toMatchObject({ termName: "Term 1", progress: { met: 1, required: 3, status: "on_track" } });
		expect(summary.pendingSurveys).toBe(1);
		expect(summary.oldestPendingSurveyId).toBe("srv_1");
		expect(summary.upcomingEvents).toBe(1);
		expect(summary.linkClicks).toBe(12);
	});

	it("does not count a form past its closing time, or a walk-in row, as pending", async () => {
		for (const [id, closesAt, source] of [
			["srv_open", NOW.getTime() + 3_600_000, "invited"],
			["srv_late", NOW.getTime() - 1, "invited"],
			["srv_walk", null, "walk_in"],
		] as const) {
			await env.DB.prepare("INSERT INTO surveys (id, title, status, created_by, closes_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, id, "running", "mem_admin", closesAt)
				.run();
			await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id, completed_at, source) VALUES (?, ?, ?, ?)")
				.bind(id, "mem_ov", null, source)
				.run();
		}

		const repository = createOverviewRepository(drizzle(env.DB, { schema }));
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary.pendingSurveys).toBe(1);
		expect(summary.oldestPendingSurveyId).toBe("srv_open");
	});

	it("links the oldest open invited form, skipping answered, closed and draft ones", async () => {
		const rows = [
			// [survey, status, assigned at, completed at]
			["srv_answered", "running", 1, NOW.getTime() - 60_000],
			["srv_closed", "closed", 2, null],
			["srv_draft", "draft", 3, null],
			["srv_newer", "running", 20, null],
			["srv_older", "running", 10, null],
		] as const;
		for (const [id, status, assignedAt, completedAt] of rows) {
			await env.DB.prepare("INSERT INTO surveys (id, title, status, created_by) VALUES (?, ?, ?, ?)").bind(id, id, status, "mem_admin").run();
			await env.DB.prepare("INSERT INTO survey_assignments (survey_id, member_id, assigned_at, completed_at, source) VALUES (?, ?, ?, ?, ?)")
				.bind(id, "mem_ov", assignedAt, completedAt, "invited")
				.run();
		}

		const summary = await createOverviewRepository(drizzle(env.DB, { schema })).getSummary(memberActor, NOW);

		expect(summary.pendingSurveys).toBe(2);
		expect(summary.oldestPendingSurveyId).toBe("srv_older");
	});

	it("returns zeroed counts and a null term when the member has no activity and no active term", async () => {
		await env.DB.prepare("DELETE FROM terms").run();
		const db = drizzle(env.DB, { schema });
		const repository = createOverviewRepository(db);
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary).toEqual({
			retention: null,
			pendingSurveys: 0,
			oldestPendingSurveyId: null,
			upcomingEvents: 0,
			linkClicks: 0,
		});
	});

	it("meets a part from fractional points", async () => {
		for (const [id, points] of [["ret_fraction_a", 0.3], ["ret_fraction_b", 0.7]] as const) {
			await env.DB.prepare(`
				INSERT INTO retention_records
					(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
				.bind(id, "mem_ov", "term_now", "pt_ts", points, id, "manual", "mem_admin", NOW.getTime())
				.run();
		}

		const repository = createOverviewRepository(drizzle(env.DB, { schema }));
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary.retention?.progress.parts[0].slots[0]).toMatchObject({ earned: 1, state: "met" });
	});
});
