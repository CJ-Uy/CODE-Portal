import { env } from "cloudflare:test";
import type { InferInsertModel } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { libraryItems } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { refreshSearchText } from "./library";

export const actors: { owner: Actor; other: Actor; moderator: Actor } = {
	owner: { memberId: "owner", roles: ["member"] },
	other: { memberId: "other", roles: ["member"] },
	moderator: { memberId: "moderator", roles: ["publishing"] },
};

export async function seedMembers(ids: string[]): Promise<void> {
	for (const id of ids) {
		await env.DB.prepare("INSERT OR IGNORE INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind(id, `${id}@example.org`, id, Date.now(), Date.now())
			.run();
	}
}

/** Wipes everything the library tests touch, so each test starts from an empty library. */
export async function resetLibrary(): Promise<void> {
	for (const table of ["audit_logs", "library_items", "library_lists", "library_tags", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

/** A published, members-only item with the search index filled in; override anything. Returns its id. */
export async function insertItem(overrides: Partial<InferInsertModel<typeof libraryItems>> = {}): Promise<string> {
	const db = drizzle(env.DB, { schema });
	const id = overrides.id ?? createId("lib");
	await db.insert(libraryItems).values({ title: "Untitled", ...overrides, id });
	if (overrides.searchText === undefined) await refreshSearchText(db, id);
	return id;
}
