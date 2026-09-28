import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test.beforeEach(async ({ page }) => {
	await signInAs(page, "member");
	await page.goto("/portal/calendar");
	await page.getByRole("button", { name: "Create event" }).click();
});

test("the create event sheet slides in", async ({ page }) => {
	const sheet = page.locator('[data-slot="sheet-content"]');
	await expect(sheet).toBeVisible();
	await expect.poll(() => sheet.evaluate((element) => getComputedStyle(element).animationName)).not.toBe("none");
});

test("event creators can make signup answers visible to members", async ({ page }) => {
	const checkbox = page.getByRole("checkbox", { name: "Let members see signup answers" });
	await expect(checkbox).toBeVisible();
	await expect(checkbox).not.toBeChecked();
});

test("invalid event details show a field error without closing the sheet", async ({ page }) => {
	await page.getByRole("textbox", { name: "Title" }).fill("Study session");
	await page.getByRole("textbox", { name: "Place" }).fill("Hall");
	await page.getByRole("textbox", { name: "Description" }).fill("Study together");
	await page.getByRole("spinbutton", { name: /Capacity/ }).fill("0");

	const response = page.waitForResponse((candidate) => candidate.url().endsWith("/portal/calendar") && candidate.request().method() === "POST");
	await page.getByRole("button", { name: "Create event" }).last().click();

	expect((await response).status()).toBe(200);
	await expect(page.getByRole("alert")).toContainText("capacity:");
	await expect(page.getByRole("alert")).toBeInViewport();
	await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Study session");
});

test("the create event sheet does not overflow mobile or desktop viewports", async ({ page }) => {
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 720 },
	]) {
		await page.setViewportSize(viewport);
		await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
});
