import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEmailRepositories } from "./email";

const db = drizzle(env.DB, { schema });
const repos = createEmailRepositories(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_admin", roles: ["email"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

describe("email settings and templates", () => {
	beforeEach(async () => {
		for (const table of ["email_templates", "email_categories", "email_senders", "audit_logs", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_admin", "mem_plain"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, `${id}@example.com`, id, Date.now(), Date.now())
				.run();
		}
	});

	it("saves a sender only on the CODE domain, lowercased", async () => {
		const sender = await repos.settings.saveSender(admin, { address: "Events@AteneoCODE.org", displayName: "CODE Events" });
		expect(sender.address).toBe("events@ateneocode.org");
		await expect(repos.settings.saveSender(admin, { address: "me@gmail.com", displayName: "Me" })).rejects.toThrow(/ateneocode\.org/);
	});

	it("rejects a sender address with no local part", async () => {
		await expect(repos.settings.saveSender(admin, { address: "@ateneocode.org", displayName: "Nobody" })).rejects.toThrow(/valid/);
	});

	it("refuses members without the email role", async () => {
		await expect(repos.settings.listSenders(member)).rejects.toThrow(/Not authorized/);
		await expect(repos.settings.saveCategory(member, { name: "News", description: "", required: false, defaultSenderId: null })).rejects.toThrow(
			/Not authorized/,
		);
	});

	it("orders categories and moves them", async () => {
		const a = await repos.settings.saveCategory(admin, { name: "Announcements", description: "", required: true, defaultSenderId: null });
		const b = await repos.settings.saveCategory(admin, { name: "Newsletter", description: "", required: false, defaultSenderId: null });
		expect((await repos.settings.listCategories(admin)).map((c) => c.id)).toEqual([a.id, b.id]);
		await repos.settings.moveCategory(admin, b.id, "up");
		expect((await repos.settings.listCategories(admin)).map((c) => c.id)).toEqual([b.id, a.id]);
	});

	it("hides archived categories unless asked", async () => {
		const a = await repos.settings.saveCategory(admin, { name: "Old", description: "", required: false, defaultSenderId: null });
		await repos.settings.setCategoryArchived(admin, a.id, true);
		expect(await repos.settings.listCategories(admin)).toHaveLength(0);
		expect(await repos.settings.listCategories(admin, { includeArchived: true })).toHaveLength(1);
	});

	it("validates template content and duplicates templates", async () => {
		await expect(
			repos.templates.save(admin, { name: "Bad", categoryId: null, subject: "Hi {{points}}", preheader: "", blocks: [] }),
		).rejects.toThrow(/Unknown field/);
		const saved = await repos.templates.save(admin, {
			name: "Weekly",
			categoryId: null,
			subject: "Hi {{first_name}}",
			preheader: "",
			blocks: [{ id: "t", type: "text", props: { text: "Hello" } }],
		});
		const copy = await repos.templates.duplicate(admin, saved.id);
		expect(copy.name).toBe("Weekly (copy)");
		expect(copy.blocks).toEqual(saved.blocks);
		expect((await repos.templates.list(admin)).map((t) => t.name).sort()).toEqual(["Weekly", "Weekly (copy)"]);
	});
});
