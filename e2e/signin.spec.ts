import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("a seeded member can reach the portal via mocked sign-in", async ({ page }) => {
	await page.goto("/signin");
	await expect(page).toHaveURL(/\/signin/);

	await signInAs(page, "member");

	await expect(page).toHaveURL(/\/portal/);
	await expect(page.getByRole("main")).toBeVisible();
});

test("an unauthenticated visit to /portal redirects to sign-in", async ({ page }) => {
	await page.goto("/portal");
	await expect(page).toHaveURL(/\/signin/);
});
