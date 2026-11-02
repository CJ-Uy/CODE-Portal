import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("members see retention requirements and the records behind their points", async ({ page }) => {
	const errors: string[] = [];
	page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
	page.on("pageerror", (error) => errors.push(error.message));
	await signInAs(page, "member");
	await page.goto("/portal/retention");
	await expect(page.getByRole("heading", { name: "Retention requirements" })).toBeVisible();
	const progress = page.getByRole("progressbar", { name: "Retention requirements", exact: true });
	await expect(progress).toHaveAttribute("aria-valuemax", "12");
	await expect(progress).toHaveAttribute("aria-valuetext", /of 12 requirements met/);
	const history = page.getByRole("region", { name: "Activity history" });
	await expect(history).toContainText("Manual record");
	await expect(history).toContainText("Event attendance");
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(history.getByRole("combobox")).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
	expect(errors).toEqual([]);
});
