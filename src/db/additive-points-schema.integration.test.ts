import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

async function resetRows() {
	await env.DB.prepare("DELETE FROM event_point_awards").run();
	await env.DB.prepare("DELETE FROM retention_records").run();
	await env.DB.prepare("DELETE FROM crs_events").run();
	await env.DB.prepare("DELETE FROM terms").run();
	await env.DB.prepare("DELETE FROM point_types").run();
	await env.DB.prepare("DELETE FROM members").run();
}

describe("additive points schema on D1", () => {
	beforeEach(resetRows);

	it("defaults existing-style retention inserts and enforces one event award per point type", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_points", "points@example.com", "Points")
			.run();
		await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)")
			.bind("term_points", "Points term", 20, 10, 0, 1)
			.run();
		await env.DB.prepare("INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind("evt_points", "Points event", "official", "approved", "Room", 0, "Schema test", "mem_points", "secret")
			.run();
		await env.DB.prepare("INSERT INTO point_types (id, key, label, active, position) VALUES (?, ?, ?, ?, ?)")
			.bind("pt_retention", "retention", "Retention", 1, 0)
			.run();
		await env.DB.prepare("INSERT INTO point_types (id, key, label, active, position) VALUES (?, ?, ?, ?, ?)")
			.bind("pt_frontliner", "frontliner", "Frontliner", 1, 1)
			.run();

		await env.DB.prepare("INSERT INTO retention_records (id, member_id, term_id, event_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind("ret_default", "mem_points", "term_points", "evt_points", 5, "Legacy-shaped insert", "event_attendance", "mem_points", 0)
			.run();
		const defaulted = await env.DB.prepare("SELECT point_type_id FROM retention_records WHERE id = ?")
			.bind("ret_default")
			.first<{ point_type_id: string }>();
		expect(defaulted?.point_type_id).toBe("pt_retention");

		await expect(
			env.DB.prepare("INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
				.bind("ret_duplicate", "mem_points", "term_points", "evt_points", "pt_retention", 5, "Duplicate", "event_attendance", "mem_points", 1)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);

		await env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, ?)")
			.bind("evt_points", "pt_frontliner", 3)
			.run();
		await expect(
			env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, ?)")
				.bind("evt_points", "pt_frontliner", 4)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);
	});
});
