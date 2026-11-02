import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("members see retention requirements and the records behind their points", async ({ page }) => {
	const errors: string[] = [];
	page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
	page.on("pageerror", (error) => errors.push(error.message));
	await signInAs(page, "member");
	await page.goto("/portal/retention");
	await expect(page.getByRole("heading", { name: "Retention requirements" })).toBeVisible();
	for (const [label, maximum] of [["Overall", 12], ["1st semester", 4], ["2nd semester", 4]] as const) {
		const ring = page.getByRole("progressbar", { name: `${label} retention points`, exact: true });
		await expect(ring).toHaveAttribute("aria-valuemax", String(maximum));
		await expect(ring).toHaveAttribute("aria-valuetext", new RegExp(`of ${maximum} retention points`));
	}
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
