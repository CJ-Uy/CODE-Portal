import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { signInAs, type SeededRole } from "./fixtures/auth";

// Everything here is made through the UI with obviously fake titles ("E2E ..."). The database is touched only to sweep
// those rows (and their uploaded files) away again.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 180_000 });

const run = randomBytes(3).toString("hex");
const PDF_NAME = "e2e-library.pdf";
// Enough for the upload route's magic check, which only reads the first bytes.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const DB_PATH = process.env.LOCAL_SQLITE_PATH ?? resolve(".local/dev.db");
const UPLOADS = resolve(process.env.LOCAL_STORAGE_DIR ?? ".local/uploads", "library");

function sweep(): void {
	const db = new Database(DB_PATH);
	try {
		db.pragma("foreign_keys = ON");
		const items = db.prepare("SELECT id FROM library_items WHERE title LIKE 'E2E%' AND created_by = 'mem_demo_member'").pluck().all() as string[];
		const lists = db.prepare("SELECT id FROM library_lists WHERE name LIKE 'E2E%'").pluck().all() as string[];
		db.transaction(() => {
			// Items and lists cascade to their tags, comments, notes, members, reports and reading days.
			for (const id of items) db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
			for (const id of lists) db.prepare("DELETE FROM library_lists WHERE id = ?").run(id);
			for (const id of [...items, ...lists]) db.prepare("DELETE FROM audit_logs WHERE target_id = ?").run(id);
			db.prepare("DELETE FROM notifications WHERE body LIKE '%\"E2E%'").run();
		})();
		for (const id of items) rmSync(join(UPLOADS, id), { recursive: true, force: true });
	} finally {
		db.close();
	}
}

test.beforeAll(sweep);
test.afterAll(sweep);

async function openAs(browser: Browser, baseURL: string, role: SeededRole, viewport = { width: 1280, height: 900 }) {
	const context = await browser.newContext({ baseURL, viewport });
	const page = await context.newPage();
	await signInAs(page, role);
	return { context, page };
}

const HEADINGS = { file: "Upload a file", link: "Add a link" } as const;

/** Starts a draft on /new and returns its id, from the edit page it lands on. */
async function startDraft(page: Page, input: { format: keyof typeof HEADINGS; title: string; kind?: string }): Promise<string> {
	await page.goto("/portal/library/new");
	const card = page.locator("form").filter({ has: page.getByRole("heading", { name: HEADINGS[input.format] }) });
	if (input.kind) await card.locator("label").filter({ hasText: input.kind }).click();
	await card.getByRole("textbox", { name: "Title" }).fill(input.title);
	await card.getByRole("button", { name: "Start draft" }).click();
	await page.waitForURL(/\/portal\/library\/[^/]+\/edit$/);
	return new URL(page.url()).pathname.split("/").at(-2)!;
}

async function attachPdf(page: Page): Promise<void> {
	await page.locator('input[type="file"]').setInputFiles({ name: PDF_NAME, mimeType: "application/pdf", buffer: PDF });
	await expect(page.getByText(PDF_NAME, { exact: true })).toBeVisible();
}

/** The publish dialog: answers the client-data question and confirms. */
async function publish(page: Page, clientData: boolean): Promise<void> {
	await page.getByRole("button", { name: "Publish", exact: true }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("radio", { name: clientData ? /^Yes/ : /^No/ }).check();
	await dialog.getByRole("button", { name: clientData ? "Send for approval" : "Publish now" }).click();
}

async function publishPdf(page: Page, title: string, options: { clientData: boolean; kind?: string }): Promise<string> {
	const id = await startDraft(page, { format: "file", title, kind: options.kind });
	await attachPdf(page);
	await publish(page, options.clientData);
	return id;
}

async function searchFor(page: Page, text: string): Promise<void> {
	await page.goto("/portal/library");
	await page.getByRole("searchbox", { name: "Search the library" }).fill(text);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await page.waitForURL(/[?&]q=/);
}

test("a member uploads a PDF, publishes it with no client data and finds it in search", async ({ page }) => {
	const title = `E2E upload ${run}`;
	await signInAs(page, "member");

	const id = await publishPdf(page, title, { clientData: false });
	await expect(page).toHaveURL(new RegExp(`/portal/library/${id}$`));
	await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

	await searchFor(page, title);
	await expect(page.getByRole("heading", { name: "1 result" })).toBeVisible();
	await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("a case study with client data waits for a moderator, then shows up in search", async ({ page, browser, baseURL }) => {
	const title = `E2E case study ${run}`;
	await signInAs(page, "member");

	await publishPdf(page, title, { clientData: true, kind: "Case study" });
	await expect(page).toHaveURL(/\/portal\/library\/mine$/);
	await expect(page.getByRole("heading", { name: /^Waiting for approval/ })).toBeVisible();
	await expect(page.locator('section[aria-labelledby="mine-pending_review"]')).toContainText(title);

	// Until a moderator approves it, nobody finds it, its owner included.
	await searchFor(page, title);
	await expect(page.getByText("Nothing matches")).toBeVisible();

	const admin = await openAs(browser, baseURL!, "admin");
	try {
		await admin.page.goto("/portal/admin/content/library?tab=waiting");
		const row = admin.page.locator("li").filter({ hasText: title });
		await expect(row).toContainText("Includes client data");
		await row.getByRole("button", { name: "Approve" }).click();
		await expect(admin.page.getByText("Approved. It is live.")).toBeVisible();
	} finally {
		await admin.context.close();
	}

	await searchFor(page, title);
	await expect(page.getByRole("heading", { name: "1 result" })).toBeVisible();
	await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("an admin shares a list with a member editor, who adds a note and a comment the admin then sees", async ({ page: member, browser, baseURL }) => {
	const title = `E2E list item ${run}`;
	const listName = `E2E list ${run}`;
	const note = `E2E note ${run}`;
	const comment = `E2E comment ${run}`;

	await signInAs(member, "member");
	const itemId = await startDraft(member, { format: "link", title });
	await member.getByPlaceholder("https://").fill(`https://example.com/e2e-${run}`);
	await publish(member, false);
	await expect(member).toHaveURL(new RegExp(`/portal/library/${itemId}$`));

	const admin = await openAs(browser, baseURL!, "admin");
	try {
		const { page } = admin;

		// Save the item to a brand-new list.
		await page.goto(`/portal/library/${itemId}`);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		const picker = page.getByRole("dialog");
		await picker.getByLabel("New list name").fill(listName);
		await picker.getByRole("button", { name: "Add", exact: true }).click();
		await expect(picker.getByRole("checkbox", { name: listName })).toBeChecked();
		await picker.getByRole("button", { name: "Done" }).click();

		// Open it, share it, and make the member an editor.
		await page.goto("/portal/library/lists");
		await page.getByRole("link", { name: listName }).click();
		await page.waitForURL(/\/portal\/library\/lists\/[^/]+$/);
		const share = page.getByRole("switch", { name: "Share with members" });
		const shared = page.waitForResponse((response) => response.request().method() === "POST");
		await share.click();
		await shared;
		await page.reload();
		await expect(share).toHaveAttribute("aria-checked", "true");

		await page.getByText("List settings", { exact: true }).click();
		await page.getByLabel("Add an editor").fill("Demo Member");
		await page.getByRole("button", { name: /Demo Member/ }).click();
		await expect(page.getByRole("button", { name: "Remove Demo Member as an editor" })).toBeVisible();

		// The member finds the list under "Shared with me", then writes a note and a comment.
		await member.goto("/portal/library/lists");
		await member.locator('section[aria-labelledby="shared-lists-title"]').getByRole("link", { name: listName }).click();
		await member.waitForURL(/\/portal\/library\/lists\/[^/]+$/);
		await expect(member.getByRole("link", { name: title })).toBeVisible();

		await member.getByLabel("Note", { exact: true }).fill(note);
		await member.getByRole("button", { name: "Save note" }).click();
		await expect(member.getByText("Saved", { exact: true })).toBeVisible();

		await member.getByLabel("Add a comment").fill(comment);
		await member.getByRole("button", { name: "Comment", exact: true }).click();
		// The count is what proves the post landed: a controlled textarea echoes its own text, so the comment text alone would match too early.
		await expect(member.getByRole("heading", { name: "Comments (1)" })).toBeVisible();

		// The admin sees both.
		await page.reload();
		await expect(page.getByLabel("Note", { exact: true })).toHaveValue(note);
		await expect(page.getByRole("heading", { name: "Comments (1)" })).toBeVisible();
		await expect(page.getByText(comment)).toBeVisible();
	} finally {
		await admin.context.close();
	}
});

test("a 120-character title with no spaces never scrolls the page sideways at 375px", async ({ page }) => {
	const title = `E2Emobile${run}`.padEnd(120, "w");
	expect(title).toHaveLength(120);
	const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);

	await page.setViewportSize({ width: 375, height: 812 });
	await signInAs(page, "member");

	const id = await publishPdf(page, title, { clientData: false });
	await expect(page).toHaveURL(new RegExp(`/portal/library/${id}$`));
	await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
	await expect(page.getByRole("link", { name: "Open PDF" })).toBeVisible();
	expect(await scrollWidth()).toBeLessThanOrEqual(375);

	// The card that carries the title: on the home shelf, in search results, and in the member's own library.
	await page.goto("/portal/library");
	await expect(page.getByRole("link", { name: title })).toBeVisible();
	expect(await scrollWidth()).toBeLessThanOrEqual(375);

	await searchFor(page, title);
	await expect(page.getByRole("link", { name: title })).toBeVisible();
	expect(await scrollWidth()).toBeLessThanOrEqual(375);

	await page.goto("/portal/library/mine");
	await expect(page.getByRole("link", { name: title })).toBeVisible();
	expect(await scrollWidth()).toBeLessThanOrEqual(375);
});
