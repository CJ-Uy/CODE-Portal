import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("retention boxes align and the rules stay readable across screen sizes", async ({ page }, testInfo) => {
	await signInAs(page, "member");
	await page.goto("/portal/retention");
	const requirements = page.getByRole("region", { name: "Retention requirements", exact: true });
	const boxes = requirements.locator("div.rounded-md");
	await expect(boxes).toHaveCount(12);
	for (const width of [1440, 768, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		const heights = await boxes.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
		expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
		expect(await boxes.evaluateAll((elements) => elements.every((element) => element.scrollHeight <= element.clientHeight))).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	}
	const summary = requirements.locator("summary");
	await summary.focus();
	await page.keyboard.press("Enter");
	const rules = requirements.locator("details");
	await expect(rules).toHaveAttribute("open", "");
	await expect(rules.getByRole("term")).toHaveText(["Across the school year", "Check-in and feedback", "Extra and other points"]);
	await page.addStyleTag({ content: "header, nav.fixed, nextjs-portal { visibility: hidden !important; }" });
	for (const width of [1440, 390, 320]) {
		await page.setViewportSize({ width, height: 900 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await rules.screenshot({ path: testInfo.outputPath(`retention-rules-${width}.png`) });
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await requirements.screenshot({ path: testInfo.outputPath("retention-requirements.png") });
	await summary.focus();
	await page.keyboard.press("Space");
	await expect(rules).not.toHaveAttribute("open");
});
