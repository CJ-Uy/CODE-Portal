import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./repositories/audit";
import { createLibraryRepository } from "./repositories/library";

describe("library v2 schema on D1", () => {
	it("has the v2 library tables and defaults", async () => {
		const db = drizzle(env.DB, { schema });
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('m1','m1@x.org','M1',0,0)").run();
		const [item] = await db.insert(schema.libraryItems).values({ id: "lib_t", title: "T" }).returning();
		expect(item.status).toBe("published");
		expect(item.format).toBe("page");
		expect(item.blocksJson).toEqual([]);
		const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
		const names = tables.results.map((r) => r.name);
		for (const t of ["library_tags", "library_item_tags", "library_list_members", "library_list_comments", "library_reports", "library_item_member_days"]) {
			expect(names).toContain(t);
		}
		expect(names).not.toContain("library_favorites");
		const [m] = await db.select().from(schema.members);
		expect(m.librarySmartSearch).toBe(true);
	});

	// Temporary: the favorites API now rides on the member's default "Saved" list (Tasks 5/13/14 replace it).
	it("keeps toggleFavorite and listFavorites working on the Saved list", async () => {
		const db = drizzle(env.DB, { schema });
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES ('m2','m2@x.org','M2')").run();
		await db.insert(schema.libraryItems).values({ id: "lib_fav", title: "Fav" });
		const repo = createLibraryRepository(db, createAuditRepository(db));
		const actor: Actor = { memberId: "m2", roles: [] };

		expect(await repo.toggleFavorite(actor, "lib_fav")).toBe(true);
		expect((await repo.listFavorites(actor)).map((item) => item.id)).toEqual(["lib_fav"]);
		const lists = await db.select().from(schema.libraryLists).where(eq(schema.libraryLists.memberId, "m2"));
		expect(lists).toHaveLength(1);
		expect(lists[0]).toMatchObject({ id: "lst_saved_m2", name: "Saved", isDefault: true });
		expect(lists[0].updatedAt?.getTime()).toBeGreaterThan(0);
		const [row] = await db.select().from(schema.libraryListItems).where(eq(schema.libraryListItems.listId, "lst_saved_m2"));
		expect(row.addedBy).toBe("m2");

		expect(await repo.toggleFavorite(actor, "lib_fav")).toBe(false);
		expect(await repo.listFavorites(actor)).toEqual([]);
		expect(await db.select().from(schema.libraryLists).where(eq(schema.libraryLists.memberId, "m2"))).toHaveLength(1);
	});
});
