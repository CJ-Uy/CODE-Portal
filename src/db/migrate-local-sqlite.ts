import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { planMigrations } from "./migrations-plan";

// ponytail: the migrations DIRECTORY is the source of truth here, matching
// `wrangler d1 migrations apply`. drizzle's meta/_journal.json is deliberately NOT
// consulted — hand-written SQL (0009) never enters the journal, so the old
// journal-driven migrator silently skipped it while D1 applied it. Do not
// "fix" this back to drizzle's migrate().
// Ceiling: statements run inside a transaction, so a migration relying on
// `PRAGMA foreign_keys=OFF` would not take effect. None do today; if one lands,
// run that file's statements outside the transaction.
const localSqlitePath = process.env.LOCAL_SQLITE_PATH ?? "./.local/dev.db";
const migrationsDir = "drizzle/migrations";

mkdirSync(dirname(localSqlitePath), { recursive: true });
const sqlite = new Database(localSqlitePath);

sqlite.exec(
	`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE,
		applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
);

function tableExists(name: string): boolean {
	const row = sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(name) as {
		count: number;
	};
	return row.count > 0;
}

const applied = (sqlite.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((row) => row.name);
const legacyAppliedCount = tableExists("__drizzle_migrations")
	? (sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get() as { count: number }).count
	: 0;

const { bootstrap, pending } = planMigrations({ files: readdirSync(migrationsDir), applied, legacyAppliedCount });

const record = sqlite.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)");
for (const name of bootstrap) record.run(name);
if (bootstrap.length > 0) console.log(`Adopted ${bootstrap.length} migration(s) already applied by drizzle.`);

for (const name of pending) {
	const statements = readFileSync(join(migrationsDir, name), "utf8")
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);
	sqlite.exec("BEGIN");
	try {
		for (const statement of statements) sqlite.exec(statement);
		record.run(name);
		sqlite.exec("COMMIT");
	} catch (error) {
		sqlite.exec("ROLLBACK");
		throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	console.log(`Applied ${name}`);
}

sqlite.close();
console.log(`${localSqlitePath} is up to date (${pending.length} applied).`);
