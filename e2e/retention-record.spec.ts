import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("an admin logs a manual retention record for a member", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal/admin/data");
	await page.waitForTimeout(750);

	await page.getByRole("button", { name: /add manual record/i }).click();
	await page.getByLabel(/search members/i).fill("member@example.com");
	await page.getByRole("listitem").filter({ hasText: /member@example.com/i }).click();
	await page.getByLabel(/reason/i).fill("Submitted the required medical waiver");
	await page.getByRole("button", { name: /add manual record/i }).last().click();

	await expect(page.getByText(/recorded 1 retention record/i)).toBeVisible();
});
