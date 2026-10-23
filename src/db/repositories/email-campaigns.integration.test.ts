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

	it("saves sheet rows with the draft, matches them to recipients and refuses to schedule fields nothing fills", async () => {
		const ids = await setup();
		const mergeSheet = {
			name: "batch.xlsx",
			importedAt: "2026-10-02T03:00:00.000Z",
			keyColumn: "Email",
			columns: [{ header: "Message", variable: "message" }, { header: "Batch", variable: "batch" }],
			rows: { "mem_a@example.com": { message: "See you Friday", batch: "2030" }, "gone@example.com": { message: "Hi", batch: "" } },
		};
		const content = { ...draftInput(ids), subject: "{{first_name}}, a note", blocks: [{ id: "h", type: "html" as const, props: { html: "<p>{{message}} {{batch}} {{points}}</p>" } }] };
		const draft = await repos.campaigns.saveDraft(admin, { ...content, mergeSheet });
		expect(draft.mergeSheet).toEqual(mergeSheet);
		expect((await repos.campaigns.saveDraft(admin, { ...content, id: draft.id })).mergeSheet).toEqual(mergeSheet);
		expect((await repos.campaigns.duplicate(admin, draft.id)).mergeSheet).toEqual(mergeSheet);

		const preview = await repos.campaigns.previewPersonalization(admin, { audience: content.audience, categoryId: ids.news.id, tags: ["first_name", "message", "batch", "points"], overrides: {}, sheet: mergeSheet });
		expect(preview.sheet).toEqual({ rows: 2, matched: 1, unmatched: ["gone@example.com"], unmatchedCount: 1, withoutRow: 1, missing: [{ variable: "message", count: 1 }] });
		expect(preview.unknown).toEqual(["points"]);
		await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id) VALUES ('mem_b', ?)").bind(ids.news.id).run();
		expect(await repos.campaigns.sheetRecipients(admin, content.audience, ids.news.id)).toEqual([{ email: "mem_a@example.com", name: "mem_a" }]);
		await env.DB.prepare("DELETE FROM email_optouts").run();
		await expect(repos.campaigns.sheetRecipients({ memberId: "mem_a", roles: ["member"] }, content.audience, null)).rejects.toThrow();
		const byEmail = Object.fromEntries(preview.rows.map((r) => [r.email, r]));
		expect(byEmail["mem_a@example.com"]).toMatchObject({ values: { message: "See you Friday", batch: "2030" }, missing: ["points"] });
		expect(byEmail["mem_b@example.com"]).toMatchObject({ values: { message: "", batch: "2027" }, missing: ["message", "points"] });

		await expect(repos.campaigns.schedule(admin, draft.id, new Date(Date.now() + 60_000))).rejects.toThrow(/Nothing fills \{\{points\}\}/);
		await repos.campaigns.saveDraft(admin, { ...content, id: draft.id, mergeOverrides: { "mem_a@example.com": { points: "3" } } });
		expect((await repos.campaigns.schedule(admin, draft.id, new Date(Date.now() + 60_000))).status).toBe("scheduled");
		expect((await repos.campaigns.saveDraft(admin, { ...content, id: draft.id, mergeSheet: null })).mergeSheet).toBeNull();
	});

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

	it("creates a scheduled feedback campaign only when the category has a sender", async () => {
		const ids = await setup();
		const at = new Date(NOW.getTime() + 2 * 60_000);
		const input = { surveyId: "svy_1", createdBy: "mem_admin", subject: "How was GA?", preheader: "p", blocks: [{ id: "t", type: "text" as const, props: { text: "Hi" } }], at };
		// The feedback category is wiped by setup(); re-create it without a default sender, as migration 0012 seeds it.
		await env.DB.prepare("INSERT INTO email_categories (id, name, description, required, sort_order) VALUES ('ecat_feedback', 'Feedback requests', '', 0, 90)").run();
		expect(await repos.campaigns.createFeedbackCampaign(input)).toBeNull();

		await env.DB.prepare("UPDATE email_categories SET default_sender_id=? WHERE id='ecat_feedback'").bind(ids.sender.id).run();
		const row = await repos.campaigns.createFeedbackCampaign(input);
		expect(row).toMatchObject({ status: "scheduled", categoryId: "ecat_feedback", senderId: ids.sender.id, subject: "How was GA?", createdBy: "mem_admin" });
		expect(row?.scheduledAt?.getTime()).toBe(at.getTime());
		expect(row?.audience).toEqual({ match: "any", include: [{ kind: "survey_invitees", surveyId: "svy_1" }], exclude: [] });
		expect((await repos.campaigns.get(admin, row!.id))?.status).toBe("scheduled");

		await env.DB.prepare("UPDATE email_senders SET archived_at=? WHERE id=?").bind(Date.now(), ids.sender.id).run();
		expect(await repos.campaigns.createFeedbackCampaign(input)).toBeNull();
		await env.DB.prepare("UPDATE email_senders SET archived_at=NULL WHERE id=?").bind(ids.sender.id).run();
		await env.DB.prepare("UPDATE email_categories SET archived_at=? WHERE id='ecat_feedback'").bind(Date.now()).run();
		expect(await repos.campaigns.createFeedbackCampaign(input)).toBeNull();
	});

	it("returns null when the feedback category does not exist", async () => {
		await setup();
		expect(await repos.campaigns.createFeedbackCampaign({ surveyId: "svy_1", createdBy: "mem_admin", subject: "s", preheader: "", blocks: [], at: NOW })).toBeNull();
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
