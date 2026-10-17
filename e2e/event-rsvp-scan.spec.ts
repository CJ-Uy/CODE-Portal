import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("an admin records attendance via the event check-in search", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal/calendar/evt_demo");
	await page.waitForTimeout(750);

	await page.getByRole("button", { name: "Check-ins", exact: true }).click();
	await page.getByPlaceholder(/search a member to check in/i).fill("Demo Member");
	await page.getByRole("button", { name: /^demo member/i }).click();

	await expect(page.getByText(/checked in demo member|demo member was already checked in/i)).toBeVisible();
});
