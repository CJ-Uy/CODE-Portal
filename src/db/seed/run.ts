import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InferInsertModel } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import {
	seedAuditLogs,
	seedAttendance,
	seedEvents,
	seedFeedbackDemoAnswers,
	seedFeedbackDemoAssignments,
	seedFeedbackDemoAttendance,
	seedFeedbackDemoDebriefs,
	seedFeedbackDemoEvents,
	seedFeedbackDemoMembers,
	seedFeedbackDemoQuestions,
	seedFeedbackDemoResponses,
	seedFeedbackDemoSurveys,
	seedForumPosts,
	seedLibraryItems,
	seedLibraryTags,
	seedLinkDailyStats,
	seedLinkHourlyStats,
	seedMemberRoles,
	seedMembers,
	seedImportantLinks,
	seedLinkCategories,
	seedPointTypes,
	seedQuickLinks,
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
} from "./data";

type SeedTarget = "local" | "dev";

const target = (process.argv[2] ?? "local") as SeedTarget;

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

type LocalSeedDb = ReturnType<typeof drizzle<typeof schema>>;
type SeedTable = SQLiteTable;

async function insertChunks<T extends InferInsertModel<SeedTable>>(db: LocalSeedDb, table: SeedTable, rows: T[]) {
	for (const rowsChunk of chunk(rows, 10)) {
		if (rowsChunk.length > 0) {
			await db.insert(table).values(rowsChunk).onConflictDoNothing().run();
		}
	}
}

async function seedLocal() {
	const localPath = process.env.LOCAL_SQLITE_PATH ?? "./.local/dev.db";
	mkdirSync(dirname(localPath), { recursive: true });
	const sqlite = new Database(localPath);
	const db = drizzle(sqlite, { schema });

	await insertChunks(db, schema.roles, seedRoles);
	await insertChunks(db, schema.members, seedMembers);
	await insertChunks(db, schema.pointTypes, seedPointTypes);
	await insertChunks(db, schema.memberRoles, seedMemberRoles);
	await insertChunks(db, schema.terms, seedTerms);
	await insertChunks(db, schema.termMemberRoster, seedTermMemberRoster);
	await insertChunks(db, schema.reservedSlugs, seedReservedSlugs);
	await insertChunks(db, schema.shortLinks, seedShortLinks);
	await insertChunks(db, schema.linkDailyStats, seedLinkDailyStats);
	await insertChunks(db, schema.linkHourlyStats, seedLinkHourlyStats);
	await insertChunks(db, schema.crsEvents, seedEvents);
	await insertChunks(db, schema.retentionRecords, seedRetentionRecords);
	await insertChunks(db, schema.crsAttendance, seedAttendance);
	await insertChunks(db, schema.eventForumPosts, seedForumPosts);
	await insertChunks(db, schema.surveys, seedSurveys);
	await insertChunks(db, schema.surveyQuestions, seedSurveyQuestions);
	await insertChunks(db, schema.surveyAssignments, seedSurveyAssignments);
	// The feedback demo: a past event with a sent form and its answers. Local only, never exported to the dev D1 seed.
	await insertChunks(db, schema.members, seedFeedbackDemoMembers);
	await insertChunks(db, schema.crsEvents, seedFeedbackDemoEvents);
	await insertChunks(db, schema.crsAttendance, seedFeedbackDemoAttendance);
	await insertChunks(db, schema.eventDebriefs, seedFeedbackDemoDebriefs);
	await insertChunks(db, schema.surveys, seedFeedbackDemoSurveys);
	await insertChunks(db, schema.surveyQuestions, seedFeedbackDemoQuestions);
	await insertChunks(db, schema.surveyAssignments, seedFeedbackDemoAssignments);
	await insertChunks(db, schema.surveyResponses, seedFeedbackDemoResponses);
	await insertChunks(db, schema.surveyAnswers, seedFeedbackDemoAnswers);
	await insertChunks(db, schema.auditLogs, seedAuditLogs);
	await insertChunks(db, schema.sharedDevTokens, seedSharedDevTokens);
	await insertChunks(db, schema.linkCategories, seedLinkCategories);
	await insertChunks(db, schema.importantLinks, seedImportantLinks);
	await insertChunks(db, schema.quickLinks, seedQuickLinks);
	await insertChunks(db, schema.libraryItems, seedLibraryItems);
	await insertChunks(db, schema.libraryTags, seedLibraryTags);

	sqlite.close();
	console.log(`Seeded ${localPath}`);
}

async function main() {
	if (target === "dev") {
		console.log("Dev D1 seeding requires an explicit reviewed Wrangler command after migrations are applied.");
		console.log("Run `pnpm db:seed:dev:export` to build .local/dev-seed.sql, then:");
		console.log("pnpm exec wrangler d1 execute DB --env dev --remote --file .local/dev-seed.sql");
		return;
	}

	await seedLocal();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
