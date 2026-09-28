import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("an admin records attendance via the scan fallback", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal");
	await page.waitForTimeout(750);

	await page.getByLabel(/search members/i).fill("member@example.com");
	await page.getByRole("button", { name: /^search$/i }).click();
	const row = page.getByRole("listitem").filter({ hasText: /demo member|member@example.com/i });
	const button = row.getByRole("button", { name: /mark present/i });
	if (await button.isDisabled()) {
		await expect(row).toContainText(/present/i);
		return;
	}
	await button.click();

	await expect(page.getByText(/marked present: mem_demo_member|already present: mem_demo_member/i)).toBeVisible();
});
