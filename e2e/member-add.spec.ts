import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("an admin gets progress and confirmation when adding a member", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal/admin/members/list");

	await expect(page.getByPlaceholder("Name optional")).toHaveCount(0);

	const email = `member-add-${Date.now()}@example.com`;
	await page.getByPlaceholder("member@example.com").fill(email);
	await page.route("**/portal/admin/members/list", async (route) => {
		if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 400));
		await route.continue();
	});

	const addForm = page.locator("form").filter({ has: page.getByPlaceholder("member@example.com") });
	await addForm.getByRole("button", { name: "Add one", exact: true }).click();
	const addingButton = page.getByRole("button", { name: "Adding member", exact: true });
	await expect(addingButton).toBeDisabled();
	await expect(addingButton.locator("svg")).toHaveClass(/animate-spin/);
	await expect(page.getByRole("status")).toHaveText("Member added.");
	await expect(page.getByRole("cell", { name: email, exact: true })).toBeVisible();

	for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
		await page.setViewportSize(viewport);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
});
