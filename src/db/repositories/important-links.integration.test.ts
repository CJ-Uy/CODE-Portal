import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createImportantLinksRepository, type ImportantLinkInput, type LinkDirectory } from "./important-links";

const navAdmin: Actor = { memberId: "mem_links_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

function repository() {
	const db = drizzle(env.DB, { schema });
	return { db, links: createImportantLinksRepository(db, createAuditRepository(db)) };
}

function link(title: string, categoryId: string | null, extra: Partial<ImportantLinkInput> = {}): ImportantLinkInput {
	return { title, url: `https://example.com/${title.toLowerCase()}`, description: null, kind: null, categoryId, showInSidebar: false, ...extra };
}

function titles(directory: LinkDirectory) {
	return {
		categories: directory.categories.map((category) => [category.name, category.links.map((item) => item.title)]),
		uncategorized: directory.uncategorized.map((item) => item.title),
	};
}

describe("important links repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM important_links").run();
		await env.DB.prepare("DELETE FROM link_categories").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(navAdmin.memberId, "links@example.com", "Links Admin")
			.run();
	});

	it("groups links under categories in admin order, with uncategorized links last, and audits each write", async () => {
		const { db, links } = repository();
		const records = await links.createCategory(navAdmin, { name: "Records" });
		const forms = await links.createCategory(navAdmin, { name: "Forms" });
		await links.createLink(navAdmin, link("Masterfile", records.id));
		await links.createLink(navAdmin, link("Tracker", records.id));
		await links.createLink(navAdmin, link("Reimbursement", forms.id));
		await links.createLink(navAdmin, link("Deck", null));

		expect(titles(await links.listDirectory(member))).toEqual({
			categories: [
				["Records", ["Masterfile", "Tracker"]],
				["Forms", ["Reimbursement"]],
			],
			uncategorized: ["Deck"],
		});
		const actions = (await db.select().from(auditLogs)).map((row) => row.action);
		expect(actions.filter((action) => action === "link_category:create")).toHaveLength(2);
		expect(actions.filter((action) => action === "important_link:create")).toHaveLength(4);
	});

	it("keeps plain members to reading", async () => {
		const { links } = repository();
		await expect(links.listForEditing(member)).rejects.toThrow("Not authorized");
		await expect(links.createCategory(member, { name: "x" })).rejects.toThrow("Not authorized");
		await expect(links.createLink(member, link("x", null))).rejects.toThrow("Not authorized");
		await expect(links.moveCategory(member, "lcat_x", "up")).rejects.toThrow("Not authorized");
		await expect(links.listDirectory(member)).resolves.toEqual({ categories: [], uncategorized: [] });
	});

	it("hides archived links and every link in an archived category until restored", async () => {
		const { db, links } = repository();
		const records = await links.createCategory(navAdmin, { name: "Records" });
		const old = await links.createCategory(navAdmin, { name: "Old" });
		const master = await links.createLink(navAdmin, link("Masterfile", records.id, { showInSidebar: true }));
		await links.createLink(navAdmin, link("Tracker", records.id));
		await links.createLink(navAdmin, link("Legacy", old.id, { showInSidebar: true }));

		await links.setLinkArchived(navAdmin, master.id, true);
		await links.setCategoryArchived(navAdmin, old.id, true);
		expect(titles(await links.listDirectory(member))).toEqual({ categories: [["Records", ["Tracker"]]], uncategorized: [] });
		expect(await links.listSidebar(member)).toEqual([]);
		expect(titles(await links.listForEditing(navAdmin))).toEqual({
			categories: [
				["Records", ["Masterfile", "Tracker"]],
				["Old", ["Legacy"]],
			],
			uncategorized: [],
		});

		await links.setLinkArchived(navAdmin, master.id, false);
		await links.setCategoryArchived(navAdmin, old.id, false);
		expect((await links.listSidebar(member)).map((item) => item.title)).toEqual(["Masterfile", "Legacy"]);
		const actions = (await db.select().from(auditLogs)).map((row) => row.action);
		expect(actions).toEqual(
			expect.arrayContaining(["important_link:archive", "important_link:restore", "link_category:archive", "link_category:restore"]),
		);
	});

	it("moves links and categories one step and leaves the ends alone", async () => {
		const { links } = repository();
		const first = await links.createCategory(navAdmin, { name: "First" });
		const second = await links.createCategory(navAdmin, { name: "Second" });
		const a = await links.createLink(navAdmin, link("A", first.id));
		await links.createLink(navAdmin, link("B", first.id));
		const c = await links.createLink(navAdmin, link("C", first.id));

		await links.moveLink(navAdmin, c.id, "up");
		await links.moveLink(navAdmin, a.id, "up");
		await links.moveCategory(navAdmin, second.id, "up");
		await links.moveCategory(navAdmin, second.id, "up");

		expect(titles(await links.listDirectory(member))).toEqual({
			categories: [
				["Second", []],
				["First", ["A", "C", "B"]],
			],
			uncategorized: [],
		});
	});

	it("files an edited link at the end of its new category", async () => {
		const { links } = repository();
		const first = await links.createCategory(navAdmin, { name: "First" });
		const second = await links.createCategory(navAdmin, { name: "Second" });
		const a = await links.createLink(navAdmin, link("A", first.id));
		await links.createLink(navAdmin, link("B", second.id));

		const moved = await links.updateLink(navAdmin, a.id, link("A2", second.id, { description: "Renamed", kind: "sheet" }));
		expect(moved).toMatchObject({ title: "A2", description: "Renamed", kind: "sheet", categoryId: second.id });
		expect(titles(await links.listDirectory(member)).categories).toEqual([
			["First", []],
			["Second", ["B", "A2"]],
		]);
		await expect(links.updateLink(navAdmin, "ilk_missing", link("x", null))).rejects.toThrow("not found");
	});

	it("orders sidebar links by category, then position, with uncategorized links last", async () => {
		const { links } = repository();
		const first = await links.createCategory(navAdmin, { name: "First" });
		const second = await links.createCategory(navAdmin, { name: "Second" });
		await links.createLink(navAdmin, link("Loose", null, { showInSidebar: true }));
		await links.createLink(navAdmin, link("Second pin", second.id, { showInSidebar: true }));
		await links.createLink(navAdmin, link("Hidden", first.id));
		await links.createLink(navAdmin, link("First pin", first.id, { showInSidebar: true }));

		expect((await links.listSidebar(member)).map((item) => item.title)).toEqual(["First pin", "Second pin", "Loose"]);
	});
});
