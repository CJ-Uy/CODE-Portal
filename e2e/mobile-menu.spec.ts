import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openMenu(page: Page) {
	await page.getByRole("button", { name: "Open menu", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Quick actions" });
	await expect(menu).toBeVisible();
	await expect(menu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	return menu;
}

async function expectNoOverflow(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("mobile tabs and grouped actions keep every released page reachable", async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
	await signInAs(page, "member");
	const tabs = page.getByRole("navigation", { name: "Portal modules", exact: true }).filter({ visible: true });
	await expect(tabs.getByRole("link")).toHaveText(["Home", "Calendar", "Retention", "Profile"]);
	await expect(tabs.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
	await tabs.getByRole("link", { name: "Retention", exact: true }).click();
	await expect(tabs.getByRole("link", { name: "Retention", exact: true })).toHaveAttribute("aria-current", "page");
	await expectNoOverflow(page);
	await page.screenshot({ path: testInfo.outputPath("mobile-retention-tabs.png") });
	const menu = await openMenu(page);
	await expect(menu.getByRole("link", { name: "Create event", exact: true })).toHaveAttribute("href", "/portal/calendar?create=1");
	await expect(menu.getByRole("link", { name: "New short link", exact: true })).toHaveAttribute("href", "/portal/links?create=1");
	const more = menu.getByRole("navigation", { name: "More modules" });
	for (const name of ["Ments Tree", "Link shortener", "Mail"]) await expect(more.getByRole("link", { name, exact: true })).toBeVisible();
	await expect(more.getByRole("link", { name: "Retention", exact: true })).toHaveCount(0);
	await expectNoOverflow(page);
	await page.screenshot({ path: testInfo.outputPath("mobile-quick-actions.png") });
	await menu.locator("summary").click();
	await expect(menu.getByRole("heading", { name: "Event check-in", exact: true })).toBeVisible();
	const handleTop = await menu.getByRole("button", { name: "Close menu or drag down" }).evaluate((element) => element.getBoundingClientRect().top);
	await menu.locator("summary").evaluate((element) => element.scrollIntoView());
	expect(await menu.getByRole("button", { name: "Close menu or drag down" }).evaluate((element) => element.getBoundingClientRect().top)).toBe(handleTop);
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
	await page.setViewportSize({ width: 320, height: 568 });
	await openMenu(page);
	await expectNoOverflow(page);
	await page.screenshot({ path: testInfo.outputPath("small-phone-menu.png") });
	await page.getByRole("button", { name: "Close menu", exact: true }).click();
	await page.setViewportSize({ width: 844, height: 390 });
	await openMenu(page);
	await expectNoOverflow(page);
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(tabs).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeHidden();
	await expectNoOverflow(page);
	await page.screenshot({ path: testInfo.outputPath("desktop-portal.png") });
	expect(errors).toEqual([]);
});

test("quick actions open creation from another page and repeatedly on the same page", async ({ page }) => {
	test.setTimeout(90_000);
	await signInAs(page, "member");
	for (const [action, route, title] of [
		["Create event", "/portal/calendar", "Create event"],
		["New short link", "/portal/links", "New short link"],
	]) {
		for (let attempt = 0; attempt < 2; attempt++) {
			const menu = await openMenu(page);
			await menu.getByRole("link", { name: action, exact: true }).click();
			await expect(page).toHaveURL(`${route}?create=1`);
			const form = page.getByRole("dialog", { name: title, exact: true });
			await expect(form).toBeVisible();
			await expectNoOverflow(page);
			await form.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(form).toHaveCount(0);
			await expect(page).toHaveURL(route);
		}
	}
	await page.goto("/portal/calendar?year=2026&month=10&view=list&create=1");
	await page.getByRole("dialog", { name: "Create event", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
	await expect(page).toHaveURL("/portal/calendar?year=2026&month=10&view=list");
	await page.goto("/portal/links?source=menu&create=1");
	await page.getByRole("dialog", { name: "New short link", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
	await expect(page).toHaveURL("/portal/links?source=menu");
});

test("the handle follows touch, cancels short drags, and dismisses long drags", async ({ page, context }) => {
	await signInAs(page, "member");
	const menu = await openMenu(page);
	const handle = menu.getByRole("button", { name: "Close menu or drag down" });
	const session = await context.newCDPSession(page);
	const box = (await handle.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 35 }] });
	await expect(menu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 35)");
	await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(menu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	await expect(menu).toBeVisible();
	await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 100 }] });
	await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
	await expect(menu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	await expect(menu).toBeVisible();
	await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 100 }] });
	await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(menu).toHaveCount(0);
	await openMenu(page);
	await expect(menu).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y - 30, { steps: 3 });
	await page.mouse.up();
	await expect(menu).toBeVisible();
	await page.mouse.click(10, 10);
	await expect(menu).toHaveCount(0);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await openMenu(page);
	await expect(menu).toHaveCSS("animation-name", "none");
	await handle.focus();
	await page.keyboard.press("Enter");
	await expect(menu).toHaveCount(0);
});

test("creating a short link from the menu closes creation and opens its details", async ({ page }) => {
	await signInAs(page, "member");
	const menu = await openMenu(page);
	await menu.getByRole("link", { name: "New short link", exact: true }).click();
	const form = page.getByRole("dialog", { name: "New short link", exact: true });
	await form.getByPlaceholder("https://example.com", { exact: true }).fill("https://example.com/mobile-menu");
	await form.getByPlaceholder("welcome", { exact: true }).fill(`menu-${Date.now().toString(36)}`);
	await form.getByPlaceholder("Welcome page", { exact: true }).fill("Mobile menu test");
	const created = page.waitForResponse((response) => response.url().endsWith("/api/links") && response.request().method() === "POST");
	await form.getByRole("button", { name: "Create link", exact: true }).click();
	const response = await created;
	expect(response.ok()).toBe(true);
	const { link } = await response.json();
	try {
		await expect(form).toHaveCount(0);
		await expect(page).toHaveURL("/portal/links");
		await expect(page.getByRole("dialog", { name: "Mobile menu test", exact: true })).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(1);
	} finally {
		expect((await page.request.delete(`/api/links/${link.id}`, { headers: { origin: new URL(page.url()).origin } })).ok()).toBe(true);
	}
});
