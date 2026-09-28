import Database from "better-sqlite3";
import { drizzle as drizzleBetterSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { getCloudflareEnv } from "@/server/cloudflare";
import { getAppConfig } from "@/server/env";

let localDb: ReturnType<typeof drizzleBetterSqlite<typeof schema>> | null = null;

export function getDb() {
	const config = getAppConfig();

	if (config.APP_ENV === "production") {
		return getD1Db();
	}

	if (config.APP_ENV === "shared") {
		throw new Error("Shared mode uses HTTP repositories, not a local Drizzle client.");
	}

	if (!localDb) {
		const sqlite = new Database(config.LOCAL_SQLITE_PATH);
		localDb = drizzleBetterSqlite(sqlite, { schema });
	}

	return localDb;
}

export function getD1Db() {
	const env = getCloudflareEnv();
	if (!env.DB) {
		throw new Error("Cloudflare D1 binding DB is unavailable.");
	}
	return drizzleD1(env.DB, { schema });
}
