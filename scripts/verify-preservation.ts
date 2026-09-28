import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, openScratch } from "./sqlite-schema";
import { readdirSync, readFileSync } from "node:fs";

const repo = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "preserve-"));
const db = openScratch(path.join(work, "p.db"));
const dir = path.join(repo, "drizzle/migrations");

function applyOne(file: string) {
	for (const statement of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
		const trimmed = statement.trim();
		if (trimmed) db.exec(trimmed);
	}
}

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files.filter((f) => f < "0004")) applyOne(file);

// Legacy fixtures: a member, an event, and an audit row shaped like the ones
// 0014 backfills from.
db.exec(`INSERT INTO members (id, email) VALUES ('mem_fix1', 'fixture@example.com')`);
db.exec(
	`INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret)
	 VALUES ('evt_fix1', 'Fixture', 'casual', 'Room', 1000, 'd', 'mem_fix1', 'secret_fix1')`,
);
db.exec(
	`INSERT INTO audit_logs (id, action, target_type, target_id, category, detail)
	 VALUES ('aud_fix1', 'event:scan_attendance', 'event', 'evt_fix1', 'event', 'member=mem_fix1')`,
);

const legacyCounts = ["announcements", "nav_pins", "point_awards"].map((t) => ({
	table: t,
	count: (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c,
}));

applyOne("0004_unify_schema.sql");

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
	if (actual !== expected) failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
const one = (sql: string) => (db.prepare(sql).get() as { v: unknown }).v;

// Tables emptied by 0004 must have been empty first, or rows were discarded.
for (const row of legacyCounts) check(`${row.table} was empty before drop`, row.count, 0);

check("event_type_rules seeded", one("SELECT COUNT(*) AS v FROM event_type_rules"), 3);
check("official label set", one("SELECT label AS v FROM event_type_rules WHERE type='official'"), "Official");
check("casual colour set", one("SELECT colour AS v FROM event_type_rules WHERE type='casual'"), "emerald");
check("pt_retention seeded", one("SELECT COUNT(*) AS v FROM point_types WHERE id='pt_retention'"), 1);
check("publishing role seeded", one("SELECT COUNT(*) AS v FROM roles WHERE id='role_publishing'"), 1);
check("audit target backfilled", one("SELECT target_member_id AS v FROM audit_logs WHERE id='aud_fix1'"), "mem_fix1");
check("fixture member survived", one("SELECT COUNT(*) AS v FROM members WHERE id='mem_fix1'"), 1);
check("fixture event survived", one("SELECT COUNT(*) AS v FROM crs_events WHERE id='evt_fix1'"), 1);
if (one("SELECT public_code AS v FROM crs_events WHERE id='evt_fix1'") === null) {
	failures.push("public_code backfill: expected a code, got null");
}
check("member_feed_state gone", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='member_feed_state'"), 0);
check("articles gone", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='articles'"), 0);

db.close();
rmSync(work, { recursive: true, force: true });

if (failures.length > 0) {
	console.error("PRESERVATION FAILED");
	for (const failure of failures) console.error("  " + failure);
	process.exit(1);
}
console.log("PRESERVATION OK");
