import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailDeliveries } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEmailRepositories } from "./email";

const db = drizzle(env.DB, { schema });
const repos = createEmailRepositories(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_admin", roles: ["email"] };
const NOW = new Date("2026-10-02T04:00:00Z");

async function setup() {
	for (const table of ["email_deliveries", "email_campaigns", "email_optouts", "email_templates", "email_categories", "email_senders", "audit_logs", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
	for (const [id, batch] of [["mem_admin", "2026"], ["mem_a", "2027"], ["mem_b", "2027"]]) {
		await env.DB.prepare("INSERT INTO members (id, email, name, batch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(id, `${id}@example.com`, id, batch, Date.now(), Date.now())
			.run();
	}
	const sender = await repos.settings.saveSender(admin, { address: "hello@ateneocode.org", displayName: "CODE" });
	const news = await repos.settings.saveCategory(admin, { name: "Newsletter", description: "", required: false, defaultSenderId: null });
	return { sender, news };
}

const draftInput = (ids: { sender: { id: string }; news: { id: string } }) => ({
	templateId: null,
	categoryId: ids.news.id,
	senderId: ids.sender.id,
	subject: "Hi {{first_name}}",
	preheader: "",
	blocks: [{ id: "t", type: "text" as const, props: { text: "Hello" } }],
	audience: { match: "any" as const, include: [{ kind: "batch" as const, batch: "2027" }], exclude: [] },
});

describe("email campaigns", () => {
	it("checks the entire receiving audience, including outside addresses, and keeps corrections scoped to drafts", async () => {
		const ids = await setup();
		for (let i = 0; i < 55; i++) await env.DB.prepare("INSERT INTO members (id, email, batch, created_at, updated_at) VALUES (?, ?, '2027', ?, ?)").bind(`extra_${i}`, `extra_${String(i).padStart(2, "0")}@example.com`, Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id) VALUES ('mem_b', ?)").bind(ids.news.id).run();
		const audience = { ...draftInput(ids).audience, include: [...draftInput(ids).audience.include, { kind: "emails" as const, emails: ["guest@outside.org"] }] };
		const input = { audience, categoryId: ids.news.id, tags: ["first_name" as const], overrides: {} };
		const checked = await repos.campaigns.previewPersonalization(admin, input);
		expect(checked).toMatchObject({ total: 57, missingCount: 56, filtered: 57, page: 0 });
		expect(checked.rows).toHaveLength(25);
		expect((await repos.campaigns.previewPersonalization(admin, { ...input, page: 2 })).rows).toHaveLength(7);
		const mergeOverrides = { "guest@outside.org": { first_name: "Ana" } };
		const corrected = await repos.campaigns.previewPersonalization(admin, { ...input, overrides: mergeOverrides, q: "guest" });
		expect(corrected.missingCount).toBe(55);
		expect(corrected.rows[0]).toMatchObject({ external: true, values: { first_name: "Ana" }, missing: [] });
		const draft = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), audience, mergeOverrides });
		expect((await repos.campaigns.duplicate(admin, draft.id)).mergeOverrides).toEqual(mergeOverrides);
		await expect(repos.campaigns.previewPersonalization({ memberId: "mem_a", roles: ["member"] }, input)).rejects.toThrow();
		expect((await env.DB.prepare("SELECT name FROM members WHERE id='extra_0'").first<{ name: string | null }>())?.name).toBeNull();
	});
	// Each test calls setup() itself because it needs the returned sender and category ids.

	it("previews the audience with opted-out members split out", async () => {
		const ids = await setup();
		await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id, created_at) VALUES ('mem_b', ?, ?)").bind(ids.news.id, Date.now()).run();
		const preview = await repos.campaigns.previewAudience(admin, draftInput(ids).audience, ids.news.id, NOW);
		expect(preview.matched).toBe(2);
		expect(preview.willReceive).toBe(1);
		expect(preview.optedOut.map((m) => m.memberId)).toEqual(["mem_b"]);
	});

	it("counts outside recipients in the preview and flags them in the report", async () => {
		const ids = await setup();
		const audience = { match: "any" as const, include: [{ kind: "emails" as const, emails: ["mem_a@example.com", "guest@outside.org"] }], exclude: [] };
		const preview = await repos.campaigns.previewAudience(admin, audience, ids.news.id, NOW);
		expect(preview).toMatchObject({ matched: 2, willReceive: 2, outside: ["guest@outside.org"], outsideCount: 1 });
		expect(preview.recipients.map((r) => r.email)).toEqual(["mem_a@example.com"]);
		const draft = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), audience });
		await db.insert(emailDeliveries).values([
			{ id: "edl_m", campaignId: draft.id, memberId: "mem_a", email: "mem_a@example.com" },
			{ id: "edl_g", campaignId: draft.id, memberId: null, email: "guest@outside.org", isExternal: true },
		]);
		const report = await repos.campaigns.report(admin, draft.id);
		expect(report?.deliveries.map((d) => [d.email, d.external])).toEqual([
			["guest@outside.org", true],
			["mem_a@example.com", false],
		]);
	});

	it("schedules a valid draft once and refuses a second schedule", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		const at = new Date(NOW.getTime() + 2 * 60_000);
		const scheduled = await repos.campaigns.schedule(admin, draft.id, at, NOW);
		expect(scheduled.status).toBe("scheduled");
		await expect(repos.campaigns.schedule(admin, draft.id, at, NOW)).rejects.toThrow(/only drafts/i);
		const after = await repos.campaigns.get(admin, draft.id);
		expect(after?.status).toBe("scheduled");
		expect(after?.scheduledAt?.getTime()).toBe(at.getTime());
	});

	it("refuses to schedule without a sender, subject, content, or audience", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), senderId: null });
		await expect(repos.campaigns.schedule(admin, draft.id, NOW, NOW)).rejects.toThrow(/sender/i);
		const empty = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), audience: { match: "any", include: [], exclude: [] } });
		await expect(repos.campaigns.schedule(admin, empty.id, NOW, NOW)).rejects.toThrow(/audience/i);
	});

	it("refuses edits once sending, and unschedule returns to draft", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await repos.campaigns.schedule(admin, draft.id, NOW, NOW);
		await repos.campaigns.unschedule(admin, draft.id);
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("draft");
		await env.DB.prepare("UPDATE email_campaigns SET status='sending' WHERE id=?").bind(draft.id).run();
		await expect(repos.campaigns.saveDraft(admin, { ...draftInput(ids), id: draft.id })).rejects.toThrow(/can no longer be edited/i);
		const after = await repos.campaigns.get(admin, draft.id);
		expect(after?.status).toBe("sending");
		expect(after?.subject).toBe("Hi {{first_name}}");
	});

	it("cancels a sending campaign and its pending deliveries", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await env.DB.prepare("UPDATE email_campaigns SET status='sending' WHERE id=?").bind(draft.id).run();
		await env.DB.prepare("INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts) VALUES ('edl_1', ?, 'mem_a', 'a@x.com', 'pending', 0)")
			.bind(draft.id)
			.run();
		await repos.campaigns.cancel(admin, draft.id);
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("cancelled");
		const [row] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, "edl_1"));
		expect(row.status).toBe("cancelled");
	});

	it("retries only failed deliveries", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await env.DB.prepare("UPDATE email_campaigns SET status='sent' WHERE id=?").bind(draft.id).run();
		await env.DB.prepare(
			"INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts, error) VALUES ('edl_f', ?, 'mem_a', 'a@x.com', 'failed', 3, 'boom'), ('edl_s', ?, 'mem_b', 'b@x.com', 'sent', 1, NULL)",
		)
			.bind(draft.id, draft.id)
			.run();
		expect(await repos.campaigns.retryFailed(admin, draft.id)).toBe(1);
		const rows = await db.select().from(emailDeliveries);
		expect(rows.find((r) => r.id === "edl_f")).toMatchObject({ status: "pending", attempts: 0, error: null });
		expect(rows.find((r) => r.id === "edl_s")?.status).toBe("sent");
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("sending");
	});

	it("leaves a finished campaign alone when there is nothing to retry", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await env.DB.prepare("UPDATE email_campaigns SET status='sent' WHERE id=?").bind(draft.id).run();
		expect(await repos.campaigns.retryFailed(admin, draft.id)).toBe(0);
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("sent");
	});

	it("rejects a draft pointing at a missing category with a readable error", async () => {
		const ids = await setup();
		await expect(repos.campaigns.saveDraft(admin, { ...draftInput(ids), categoryId: "ecat_missing" })).rejects.toThrow(
			"That template, category, or sender no longer exists.",
		);
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await expect(repos.campaigns.saveDraft(admin, { ...draftInput(ids), id: draft.id, senderId: "esnd_missing" })).rejects.toThrow(
			"That template, category, or sender no longer exists.",
		);
	});
});
