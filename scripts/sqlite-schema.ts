import Database from "better-sqlite3";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { DbSnapshot } from "./schema-compare";

type Db = InstanceType<typeof Database>;

export function openScratch(file: string): Db {
	rmSync(file, { force: true });
	return new Database(file);
}

/** Applies every .sql file in order, the same way wrangler d1 migrations apply does. */
export function applyMigrations(db: Db, dir: string): void {
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
		const sql = readFileSync(path.join(dir, file), "utf8");
		for (const statement of sql.split("--> statement-breakpoint")) {
			const trimmed = statement.trim();
			if (!trimmed) continue;
			try {
				db.exec(trimmed);
			} catch (error) {
				throw new Error(`${file}: ${(error as Error).message}`);
			}
		}
	}
}

export function snapshot(db: Db): DbSnapshot {
	const out: DbSnapshot = { tables: {}, indexes: {} };
	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{ name: string }>;
	for (const { name } of tables) {
		const cols: DbSnapshot["tables"][string]["cols"] = {};
		const info = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
			pk: number;
		}>;
		for (const row of info) {
			cols[row.name] = { type: row.type.toLowerCase(), notnull: row.notnull, dflt: row.dflt_value, pk: row.pk > 0 ? 1 : 0 };
		}
		const fkRows = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
			from: string;
			table: string;
			to: string;
			on_delete: string;
			on_update: string;
		}>;
		const fks = fkRows.map((f) => `${f.from}->${f.table}.${f.to} del=${f.on_delete} upd=${f.on_update}`).sort();
		out.tables[name] = { cols, fks };
	}
	const indexes = db
		.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{ name: string; tbl_name: string }>;
	for (const { name, tbl_name } of indexes) {
		const listed = (db.prepare(`PRAGMA index_list("${tbl_name}")`).all() as Array<{ name: string; unique: number }>).find(
			(i) => i.name === name,
		);
		const cols = (db.prepare(`PRAGMA index_info("${name}")`).all() as Array<{ name: string }>).map((c) => c.name);
		out.indexes[name] = { table: tbl_name, unique: listed ? listed.unique : 0, cols };
	}
	return out;
}
