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

for (const file of files.filter((f) => f > "0004_unify_schema.sql" && f < "0012")) applyOne(file);
check("email role seeded", one("SELECT COUNT(*) AS v FROM roles WHERE id='role_email'"), 1);
check("unsubscribe slug reserved", one("SELECT COUNT(*) AS v FROM reserved_slugs WHERE slug='unsubscribe'"), 1);
check("email_deliveries exists", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='email_deliveries'"), 1);

// 0012 drops survey_assignments.response_token_hash; an existing invitation must survive it.
db.exec(`INSERT INTO surveys (id, title, created_by) VALUES ('srv_fix1', 'Fixture', 'mem_fix1')`);
db.exec(
	`INSERT INTO survey_assignments (survey_id, member_id, response_token_hash, completed_at)
	 VALUES ('srv_fix1', 'mem_fix1', 'hash_fix1', 2000)`,
);
// A rule saved as "Super admins only" before 0012 stored survey:configure, which CRS now holds.
db.exec(`INSERT INTO event_type_rules (type, required_permission, label) VALUES ('fix_super', 'survey:configure', 'Fixture')`);
for (const file of files.filter((f) => f >= "0012" && f < "0013")) applyOne(file);
check("fixture assignment survived", one("SELECT completed_at AS v FROM survey_assignments WHERE survey_id='srv_fix1'"), 2000);
check("fixture assignment is invited", one("SELECT source AS v FROM survey_assignments WHERE survey_id='srv_fix1'"), "invited");
check(
	"survey templates seeded",
	one("SELECT group_concat(id, ',') AS v FROM (SELECT id FROM survey_templates ORDER BY position)"),
	"stpl_standard,stpl_pulse,stpl_workshop",
);
const standard = JSON.parse(String(one("SELECT questions_json AS v FROM survey_templates WHERE id='stpl_standard'"))) as Array<{
	metricKey?: string;
}>;
check("stpl_standard question count", standard.length, 7);
check(
	"stpl_standard metric keys",
	standard.flatMap((q) => (q.metricKey ? [q.metricKey] : [])).join(","),
	"overall,flow,content,venue,return_intent",
);
check(
	"super-only rule rewritten",
	one("SELECT required_permission AS v FROM event_type_rules WHERE type='fix_super'"),
	"system:super_only",
);
check("feedback email category seeded", one("SELECT COUNT(*) AS v FROM email_categories WHERE id='ecat_feedback'"), 1);

// 0013 folds library_favorites into per-member "Saved" lists, deletes the three demo items and drops the
// favorites table. Favorites sit on real items: a favorite on a demo item would cascade away with it.
db.exec(`INSERT INTO library_items (id, title) VALUES ('lib_fix_a', 'Fixture A'), ('lib_fix_b', 'Fixture B')`);
db.exec(
	`INSERT INTO library_items (id, title) VALUES
	 ('lib_onboarding', 'Demo 1'), ('lib_events_playbook', 'Demo 2'), ('lib_internal_notes', 'Demo 3')`,
);
db.exec(
	`INSERT INTO library_favorites (member_id, library_item_id, created_at)
	 VALUES ('mem_fix1', 'lib_fix_a', 4000), ('mem_fix1', 'lib_fix_b', 3000)`,
);
// A list that predates 0013 must get updated_at backfilled from created_at, not left at the column default.
db.exec(`INSERT INTO library_lists (id, member_id, name, created_at) VALUES ('lst_fix_old', 'mem_fix1', 'Old list', 5000)`);
for (const file of files.filter((f) => f >= "0013")) applyOne(file);
check("one Saved list per favoriting member", one("SELECT COUNT(*) AS v FROM library_lists WHERE is_default = 1"), 1);
check("Saved list id", one("SELECT id AS v FROM library_lists WHERE is_default = 1"), "lst_saved_mem_fix1");
check("Saved list name", one("SELECT name AS v FROM library_lists WHERE is_default = 1"), "Saved");
check("Saved list owner", one("SELECT member_id AS v FROM library_lists WHERE is_default = 1"), "mem_fix1");
check("Saved list dated from earliest favorite", one("SELECT created_at AS v FROM library_lists WHERE id='lst_saved_mem_fix1'"), 3000);
check("Saved list holds both favorites", one("SELECT COUNT(*) AS v FROM library_list_items WHERE list_id='lst_saved_mem_fix1'"), 2);
check(
	"favorites keep their items",
	one("SELECT group_concat(library_item_id, ',') AS v FROM (SELECT library_item_id FROM library_list_items WHERE list_id='lst_saved_mem_fix1' ORDER BY library_item_id)"),
	"lib_fix_a,lib_fix_b",
);
check(
	"favorites credited to the member",
	one("SELECT COUNT(*) AS v FROM library_list_items WHERE list_id='lst_saved_mem_fix1' AND added_by='mem_fix1'"),
	2,
);
check("favorite added-at preserved", one("SELECT created_at AS v FROM library_list_items WHERE library_item_id='lib_fix_a'"), 4000);
check("library_favorites gone", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='library_favorites'"), 0);
check("demo items deleted", one("SELECT COUNT(*) AS v FROM library_items WHERE id IN ('lib_onboarding','lib_events_playbook','lib_internal_notes')"), 0);
check("real items survived", one("SELECT COUNT(*) AS v FROM library_items WHERE id IN ('lib_fix_a','lib_fix_b')"), 2);
check("existing item defaults to published", one("SELECT status AS v FROM library_items WHERE id='lib_fix_a'"), "published");
check("existing list updated_at backfilled", one("SELECT updated_at AS v FROM library_lists WHERE id='lst_fix_old'"), 5000);
check("existing list is not a Saved list", one("SELECT is_default AS v FROM library_lists WHERE id='lst_fix_old'"), 0);
check("smart search defaults on", one("SELECT library_smart_search AS v FROM members WHERE id='mem_fix1'"), 1);
db.close();
rmSync(work, { recursive: true, force: true });

if (failures.length > 0) {
	console.error("PRESERVATION FAILED");
	for (const failure of failures) console.error("  " + failure);
	process.exit(1);
}
console.log("PRESERVATION OK");
