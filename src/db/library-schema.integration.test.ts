import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

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
});
