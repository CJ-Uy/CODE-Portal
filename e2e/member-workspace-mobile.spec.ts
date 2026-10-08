import { resolve } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

let restore: (() => void) | undefined;

test.beforeAll(async ({ request }, info) => {
	const host = new URL(info.project.use.baseURL!).hostname;
	if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Workspace fixtures require a local server.");
	expect((await request.post("/api/auth/e2e", { data: { email: "member@example.com" } })).ok()).toBe(true);
	const db = new Database(process.env.LOCAL_SQLITE_PATH ?? resolve(".local/dev.db"));
	const term = db.prepare("SELECT starts_at, ends_at, name FROM terms WHERE id='term_2026_1'").get() as { starts_at: number; ends_at: number; name: string };
	restore = () => {
		db.prepare("UPDATE terms SET starts_at=?, ends_at=?, name=? WHERE id='term_2026_1'").run(term.starts_at, term.ends_at, term.name);
		db.prepare("DELETE FROM crs_events WHERE id GLOB 'e2e_workspace_*'").run();
		for (const id of ["me", "mentor", "root"]) db.prepare("DELETE FROM ments_people WHERE id=?").run(`e2e_workspace_${id}`);
		db.close();
	};
	db.transaction(() => {
	db.prepare("UPDATE terms SET starts_at=?, ends_at=?, name=? WHERE id='term_2026_1'").run(Date.parse("2026-06-08T00:00:00+08:00"), Date.parse("2027-05-15T23:59:59+08:00"), "SY 2026–2027");
	const insertPerson = db.prepare("INSERT INTO ments_people(id,name,mentor_id) VALUES(?,?,?)");
	insertPerson.run("e2e_workspace_root", "Workspace Root", null);
	insertPerson.run("e2e_workspace_mentor", "Workspace Mentor", "e2e_workspace_root");
	insertPerson.run("e2e_workspace_me", "Workspace Member", "e2e_workspace_mentor");
	const insertEvent = db.prepare("INSERT INTO crs_events(id,title,type,status,starts_at,ends_at,place,created_by,description,checkin_secret) SELECT ?,?,type,?,?,?,place,created_by,description,checkin_secret FROM crs_events WHERE id='evt_demo'");
	const tomorrow = Date.now() + 86_400_000;
	insertEvent.run("e2e_workspace_upcoming", "Upcoming workspace event", "approved", tomorrow, tomorrow + 3_600_000);
	insertEvent.run("e2e_workspace_pending", "Pending workspace event", "pending", tomorrow, tomorrow + 3_600_000);
	for (let index = 0; index < 101; index++) insertEvent.run(`e2e_workspace_past_${index}`, "Archived workspace event", "approved", 1_700_000_000_000 + index, 1_700_003_600_000 + index);
	})();
});

test.afterAll(() => restore?.());

test("Home opens with check-in and approved upcoming events after a long archive", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signInAs(page, "member");
	await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
	await expect(page.locator("main")).not.toContainText("Kumusta");
	await expect(page.locator("main canvas[aria-label='Member attendance QR code']")).toBeVisible();
	await expect(page.getByRole("link", { name: /Upcoming workspace event/ })).toBeVisible();
	await expect(page.locator("main")).not.toContainText("Pending workspace event");
	for (const width of [320, 390, 430, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	}
});

test("the check-in QR keeps its display size on a high-DPI phone", async ({ browser }, info) => {
	const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 320, height: 844 }, deviceScaleFactor: 3 });
	try {
		const page = await context.newPage();
		await signInAs(page, "member");
		const code = page.locator("main canvas[aria-label='Member attendance QR code']");
		await expect(code).toHaveAttribute("width", "660");
		expect((await code.boundingBox())!.width).toBe(220);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	} finally { await context.close(); }
});

test("a full school-year term fits mobile in all retention views", async ({ page }) => {
	await signInAs(page, "member");
	await page.goto("/portal/events");
	await expect(page.getByRole("heading", { name: "Points by week" })).toBeVisible();
	await expect(page.getByText("W46", { exact: true })).toBeAttached();
	for (const width of [320, 390, 430, 844, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const name of ["Progress", "Pie", "Bar race"]) {
			await page.getByRole("button", { name, exact: true }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	}
});

test("tree fullscreen expands, preserves zoom and returns focus", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signInAs(page, "member");
	await page.goto("/portal/ments?person=e2e_workspace_me");
	const canvas = page.getByRole("region", { name: "Ments tree canvas" });
	await expect(canvas).toBeVisible();
	await expect.poll(async () => {
		const person = await canvas.getByRole("button", { name: "Workspace Member", exact: true }).boundingBox();
		const bounds = await canvas.boundingBox();
		return Math.abs(person!.x + person!.width / 2 - bounds!.x - bounds!.width / 2);
	}).toBeLessThan(2);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText("75%");
	const height = (await canvas.boundingBox())!.height;
	await page.getByRole("button", { name: "View tree fullscreen" }).click();
	await expect(page.getByRole("dialog", { name: "Ments tree viewer" })).toBeVisible();
	expect((await canvas.boundingBox())!.height).toBeGreaterThan(height);
	expect(await page.locator("dialog").evaluate((element) => element.matches(":modal"))).toBe(true);
	await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText("75%");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "View tree fullscreen" })).toBeFocused();
	await page.getByRole("button", { name: "View tree fullscreen" }).click();
	await page.getByRole("button", { name: "Exit tree fullscreen" }).click();
	expect(await page.locator("dialog").evaluate((element) => element.matches(":modal"))).toBe(false);
	await expect(page.getByRole("button", { name: "View tree fullscreen" })).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("two fingers zoom the tree in and out and one finger can continue panning", async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "Native multitouch injection uses Chromium CDP.");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 390, height: 844 });
	await signInAs(page, "member");
	await page.goto("/portal/ments?person=e2e_workspace_me");
	const canvas = page.getByRole("region", { name: "Ments tree canvas" });
	await expect(canvas).toBeVisible();
	await canvas.scrollIntoViewIfNeeded();
	const rect = (await canvas.boundingBox())!;
	const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
	const client = await page.context().newCDPSession(page);
	const finger = (id: number, dx: number) => ({ id, x: x + dx, y });
	await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, -40), finger(2, 40)] });
	await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, -80), finger(2, 80)] });
	await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText("100%");
	await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, -20), finger(2, 20)] });
	await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText("25%");
	await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [finger(2, 20)] });
	const transform = await canvas.locator(":scope > div").getAttribute("style");
	await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, 10)] });
	await expect(canvas.locator(":scope > div")).not.toHaveAttribute("style", transform!);
	await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await page.getByRole("button", { name: "All trees", exact: true }).click();
	await canvas.getByRole("button", { name: "Workspace Mentor", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Workspace Mentor", exact: true })).toBeVisible();
	expect(errors).toEqual([]);
	await client.detach();
});
