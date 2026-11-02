import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createDrizzleRepositories } from "./index";

const admin: Actor = { memberId: "mem_pin_admin", roles: ["member_admin"] };
const member: Actor = { memberId: "mem_pin_member", roles: ["member"] };
const pinInput = { label: "Occasional shortcut", url: "https://example.com/shortcut", icon: "Globe", position: 0 };

function repository() {
	const db = drizzle(env.DB, { schema });
	const repositories = createDrizzleRepositories(db);
	expect(repositories).toHaveProperty("navPins");
	return { db, ...repositories };
}

describe("independent pinned nav links", () => {
	beforeEach(async () => {
		for (const table of ["audit_logs", "nav_pins", "important_links", "link_categories", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)").bind(admin.memberId, "pins@example.com", "Pin Admin").run();
	});

	it("starts empty even when an important link has the old sidebar flag", async () => {
		const { db, navPins } = repository();
		await db.insert(schema.importantLinks).values({ id: "ilk_old_pin", title: "Masterfile", url: "https://example.com/masterfile", showInSidebar: true });
		expect(await navPins.list(member)).toEqual([]);
	});

	it("edits, orders and removes pins without changing the categorized directory", async () => {
		const { db, navPins, importantLinks, audit } = repository();
		const category = await importantLinks.createCategory(admin, { name: "OSG" });
		const resource = await importantLinks.createLink(admin, { title: "Masterfile", url: "https://example.com/masterfile", description: null, kind: "sheet", categoryId: category.id });
		const first = await navPins.create(admin, pinInput);
		const second = await navPins.create(admin, { ...pinInput, label: "Second", position: 1 });
		await navPins.update(admin, first.id, { ...pinInput, label: "Renamed", position: 2 });
		expect((await audit.list(admin)).filter((entry) => entry.targetId === first.id).map((entry) => entry.targetLabel)).toEqual(["Renamed", "Renamed"]);
		expect((await navPins.list(member)).map((pin) => pin.id)).toEqual([second.id, first.id]);
		await importantLinks.setCategoryArchived(admin, category.id, true);
		expect(await navPins.list(member)).toHaveLength(2);
		await navPins.remove(admin, first.id);
		expect((await navPins.list(member)).map((pin) => pin.id)).toEqual([second.id]);
		expect((await importantLinks.listForEditing(admin)).categories[0].links.map((link) => link.id)).toEqual([resource.id]);
		expect((await db.select().from(schema.auditLogs)).map((row) => row.action)).toEqual(expect.arrayContaining(["nav_pin:create", "nav_pin:update", "nav_pin:delete"]));
	});

	it("allows member reads but rejects member writes and unknown pin ids", async () => {
		const { navPins } = repository();
		await expect(navPins.list(member)).resolves.toEqual([]);
		await expect(navPins.create(member, pinInput)).rejects.toThrow("Not authorized");
		await expect(navPins.update(member, "missing", pinInput)).rejects.toThrow("Not authorized");
		await expect(navPins.remove(member, "missing")).rejects.toThrow("Not authorized");
		await expect(navPins.update(admin, "missing", pinInput)).rejects.toThrow("not found");
		await expect(navPins.remove(admin, "missing")).rejects.toThrow("not found");
	});
});
