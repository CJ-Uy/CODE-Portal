import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailOptouts } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { applyTokenOptOut, createEmailMemberRepository } from "./email-member";

const db = drizzle(env.DB, { schema });
const repo = createEmailMemberRepository(db);
const ana: Actor = { memberId: "mem_a", roles: ["member"] };
const ben: Actor = { memberId: "mem_b", roles: ["member"] };

describe("email member side", () => {
	beforeEach(async () => {
		for (const table of ["email_optouts", "email_deliveries", "email_campaigns", "email_categories", "email_senders", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_a", "mem_b"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, `${id}@x.com`, id, Date.now(), Date.now()).run();
		}
		await env.DB.prepare(
			"INSERT INTO email_categories (id, name, description, required, sort_order, created_at) VALUES ('ecat_req', 'Memos', 'Official memos', 1, 0, ?), ('ecat_opt', 'Newsletter', 'Monthly news', 0, 1, ?), ('ecat_old', 'Old', '', 0, 2, ?)",
		)
			.bind(Date.now(), Date.now(), Date.now())
			.run();
		await env.DB.prepare("UPDATE email_categories SET archived_at = ? WHERE id = 'ecat_old'").bind(Date.now()).run();
		await env.DB.prepare(
			"INSERT INTO email_campaigns (id, category_id, subject, preheader, blocks, audience, status, created_at, updated_at) VALUES ('ecmp_1', 'ecat_opt', 'Hi {{first_name}}', 'News', '[{\"id\":\"t\",\"type\":\"text\",\"props\":{\"text\":\"Hello {{first_name}}\"}}]', '{\"match\":\"any\",\"include\":[],\"exclude\":[]}', 'sent', ?, ?)",
		)
			.bind(Date.now(), Date.now())
			.run();
		await env.DB.prepare(
			"INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts, sent_at) VALUES ('edl_a', 'ecmp_1', 'mem_a', 'mem_a@x.com', 'sent', 1, ?), ('edl_b', 'ecmp_1', 'mem_b', 'mem_b@x.com', 'failed', 3, NULL)",
		)
			.bind(Date.now())
			.run();
	});

	it("lists only sent emails for the member and marks them read", async () => {
		expect((await repo.listArchive(ana)).map((i) => i.deliveryId)).toEqual(["edl_a"]);
		expect(await repo.listArchive(ben)).toEqual([]);
		expect(await repo.unreadCount(ana)).toBe(1);
		const view = await repo.getForReader(ana, "edl_a", "https://beta.ateneocode.org");
		expect(view?.subject).toBe("Hi mem_a");
		expect(view?.bodyHtml).toContain("Hello mem_a");
		expect(await repo.unreadCount(ana)).toBe(0);
	});

	it("refuses to show another member's email", async () => {
		expect(await repo.getForReader(ben, "edl_a", "https://beta.ateneocode.org")).toBeNull();
	});

	it("lists required categories first and blocks opting out of them", async () => {
		const prefs = await repo.listPreferences(ana);
		expect(prefs.map((p) => [p.id, p.required, p.optedOut])).toEqual([
			["ecat_req", true, false],
			["ecat_opt", false, false],
		]);
		await expect(repo.setOptOut(ana, "ecat_req", true)).rejects.toThrow(/required/i);
		await repo.setOptOut(ana, "ecat_opt", true);
		expect((await repo.listPreferences(ana)).find((p) => p.id === "ecat_opt")?.optedOut).toBe(true);
		await repo.setOptOut(ana, "ecat_opt", false);
		expect(await db.select().from(emailOptouts)).toHaveLength(0);
	});

	it("applies a token opt-out only for active optional categories", async () => {
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_opt" }, true)).toEqual({ categoryName: "Newsletter", requiredNames: ["Memos"] });
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_req" }, true)).toBeNull();
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_old" }, true)).toBeNull();
		expect(await applyTokenOptOut(db, { memberId: "mem_gone", categoryId: "ecat_opt" }, true)).toBeNull();
		expect(await db.select().from(emailOptouts)).toHaveLength(1);
	});
});
