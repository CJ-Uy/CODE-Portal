import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { buildExistingAttendanceAwardUpsert } from "@/db/repositories/event-awards";

const migrationsDir = "drizzle/migrations";
const sqlite = new Database(":memory:");

try {
	for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
		for (const statement of readFileSync(join(migrationsDir, file), "utf8").split("--> statement-breakpoint")) {
			if (statement.trim()) sqlite.exec(statement);
		}
	}

	sqlite.exec(`
		INSERT INTO members (id, email, name)
		VALUES ('mem_local', 'local@example.com', 'Local Member');
		INSERT INTO point_types
			(id, key, label, active, position, updated_by)
		VALUES ('pt_retention', 'retention', 'Retention', 1, 0, 'mem_local');
		INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at)
		VALUES ('term_local', 'Local Term', 20, 10, 0, 2000);
		INSERT INTO crs_events
			(id, title, type, status, place, starts_at, ends_at, description, created_by, checkin_secret)
		VALUES ('evt_local', 'Local Event', 'official', 'approved', 'Room', 500, 1500, 'Local check', 'mem_local', 'secret');
		INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by)
		VALUES ('evt_local', 'mem_local', 1000, 'mem_local');
		INSERT INTO event_point_awards (event_id, point_type_id, points)
		VALUES ('evt_local', 'pt_retention', 2);
	`);

	const db = drizzle(sqlite, { schema });
	buildExistingAttendanceAwardUpsert(db, "evt_local").run();
	sqlite.prepare("UPDATE event_point_awards SET points = 7 WHERE event_id = 'evt_local'").run();
	buildExistingAttendanceAwardUpsert(db, "evt_local").run();

	const rows = sqlite
		.prepare(`
			SELECT point_type_id AS pointTypeId, points
			  FROM retention_records
			 WHERE event_id = 'evt_local'
			   AND member_id = 'mem_local'
		`)
		.all() as Array<{ pointTypeId: string; points: number }>;

	if (rows.length !== 1 || rows[0].pointTypeId !== "pt_retention" || rows[0].points !== 7) {
		throw new Error(`Local partial-index upsert failed: ${JSON.stringify(rows)}`);
	}
	console.log("Local partial-index upsert verified.");
} finally {
	sqlite.close();
}
