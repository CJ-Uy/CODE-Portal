import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("members switch retention charts, scrub the race and filter color-coded history", async ({ page }) => {
	await signInAs(page, "member");
	await page.goto("/portal/events");
	await page.getByRole("button", { name: "Pie", exact: true }).click();
	await expect(page.getByRole("img", { name: /category share/i })).toBeVisible();
	await page.getByRole("button", { name: "Bar race", exact: true }).click();
	await page.getByRole("button", { name: "Reset", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Timeline" })).toHaveValue("0");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Timeline" })).not.toHaveValue("0");
	await page.getByRole("button", { name: "Progress", exact: true }).click();
	await page.getByLabel("Measure", { exact: true }).selectOption("activities");
	await expect(page.getByText("Each attended event counts once.", { exact: false })).toBeVisible();
	await page.getByLabel("Category", { exact: true }).selectOption("source:manual");
	await expect(page.getByRole("table")).toContainText("Manual record");
	await expect(page.getByRole("table")).not.toContainText("Event attendance");
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(page.getByRole("columnheader")).toHaveCount(4);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
});
