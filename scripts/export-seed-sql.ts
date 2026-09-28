import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { InferInsertModel } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import {
	seedAuditLogs,
	seedEvents,
	seedLibraryItems,
	seedLinkDailyStats,
	seedMemberRoles,
	seedMembers,
	seedPointTypes,
	seedReservedSlugs,
	seedRetentionRecords,
	seedRoles,
	seedSharedDevTokens,
	seedShortLinks,
	seedSurveyAssignments,
	seedSurveyQuestions,
	seedSurveys,
	seedTermMemberRoster,
	seedTerms,
} from "@/db/seed/data";

// ponytail: builds the dev D1 seed file by seeding a scratch local sqlite db with
// the real drizzle insert path, then dumping each row back out as literal SQL.
// Reuses already-verified insert logic instead of hand-mapping column types.

const SCRATCH_PATH = "./.local/seed-export-scratch.db";
const OUTPUT_PATH = "./.local/dev-seed.sql";

interface SeedTableEntry<T extends SQLiteTable> {
	table: T;
	name: string;
	rows: InferInsertModel<T>[];
}

function entry<T extends SQLiteTable>(table: T, name: string, rows: InferInsertModel<T>[]): SeedTableEntry<SQLiteTable> {
	return { table, name, rows } as SeedTableEntry<SQLiteTable>;
}

const TABLES_IN_ORDER: SeedTableEntry<SQLiteTable>[] = [
	entry(schema.roles, "roles", seedRoles),
	entry(schema.members, "members", seedMembers),
	entry(schema.pointTypes, "point_types", seedPointTypes),
	entry(schema.memberRoles, "member_roles", seedMemberRoles),
	entry(schema.terms, "terms", seedTerms),
	entry(schema.termMemberRoster, "term_member_roster", seedTermMemberRoster),
	entry(schema.reservedSlugs, "reserved_slugs", seedReservedSlugs),
	entry(schema.shortLinks, "short_links", seedShortLinks),
	entry(schema.linkDailyStats, "link_daily_stats", seedLinkDailyStats),
	entry(schema.crsEvents, "crs_events", seedEvents),
	entry(schema.retentionRecords, "retention_records", seedRetentionRecords),
	entry(schema.surveys, "surveys", seedSurveys),
	entry(schema.surveyQuestions, "survey_questions", seedSurveyQuestions),
	entry(schema.surveyAssignments, "survey_assignments", seedSurveyAssignments),
	entry(schema.auditLogs, "audit_logs", seedAuditLogs),
	entry(schema.sharedDevTokens, "shared_dev_tokens", seedSharedDevTokens),
	entry(schema.libraryItems, "library_items", seedLibraryItems),
];

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}

function literal(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "1" : "0";
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
	mkdirSync(".local", { recursive: true });
	rmSync(SCRATCH_PATH, { force: true });

	const sqlite = new Database(SCRATCH_PATH);
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite, { schema });

	// Build the scratch schema from the checked-in migrations so column
	// names/types match the real dev D1 exactly.
	const { readdirSync, readFileSync } = await import("node:fs");
	const migrationFiles = readdirSync("drizzle/migrations")
		.filter((f) => f.endsWith(".sql"))
		.sort();
	for (const file of migrationFiles) {
		const contents = readFileSync(`drizzle/migrations/${file}`, "utf8");
		const statements = contents.split("--> statement-breakpoint");
		for (const statement of statements) {
			const trimmed = statement.trim();
			if (trimmed.length > 0) sqlite.exec(trimmed);
		}
	}

	for (const { table, rows } of TABLES_IN_ORDER) {
		for (const rowsChunk of chunk(rows, 10)) {
			if (rowsChunk.length > 0) {
				await db.insert(table).values(rowsChunk).onConflictDoNothing().run();
			}
		}
	}

	const lines: string[] = [];
	for (const { name } of TABLES_IN_ORDER) {
		const columns = sqlite.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
		const colNames = columns.map((c) => c.name);
		const seedRows = sqlite.prepare(`SELECT * FROM ${name}`).all() as Record<string, unknown>[];
		for (const row of seedRows) {
			const values = colNames.map((col) => literal(row[col])).join(", ");
			lines.push(`INSERT OR IGNORE INTO ${name} (${colNames.join(", ")}) VALUES (${values});`);
		}
	}

	writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n");
	sqlite.close();
	rmSync(SCRATCH_PATH, { force: true });
	rmSync(`${SCRATCH_PATH}-wal`, { force: true });
	rmSync(`${SCRATCH_PATH}-shm`, { force: true });
	console.log(`Wrote ${lines.length} statements to ${OUTPUT_PATH}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
