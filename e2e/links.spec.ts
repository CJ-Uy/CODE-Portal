import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("a member can create, customize, verify, and inspect a short link", async ({ page }, testInfo) => {
	test.setTimeout(120_000);
	const reactKeyWarnings: string[] = [];
	page.on("console", (message) => {
		if (message.text().includes("children with the same key")) reactKeyWarnings.push(message.text());
	});
	await signInAs(page, "member");
	await page.goto("/portal/links");

	const shortLinkTrigger = page.getByRole("button", { name: "Welcome link", exact: true });
	await expect(shortLinkTrigger).toBeVisible();
	await shortLinkTrigger.click();
	const shortDialog = page.getByRole("dialog", { name: "Welcome link" });
	await expect(shortDialog.getByText(/Scan check passed/)).toBeVisible({ timeout: 20_000 });
	await shortDialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(shortLinkTrigger).toBeFocused();

	await page.getByRole("button", { name: "Copy Welcome link short link" }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	const slug = `e2e-${Date.now().toString(36)}-long-long-long-long`.slice(0, 32);
	await page.getByRole("button", { name: "New short link" }).click();
	await page.getByPlaceholder("welcome", { exact: true }).fill(slug);
	await page.getByPlaceholder("https://example.com", { exact: true }).fill("https://example.com/e2e-target?campaign=acceptance#details");
	await page.getByPlaceholder("Welcome page", { exact: true }).fill("E2E QR matrix");
	await page.getByRole("button", { name: /create link/i }).click();

	const dialog = page.getByRole("dialog", { name: "E2E QR matrix" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");

	const patterns = ["Classic", "Rounded", "Dots", "Soft", "Classy", "Classy rounded"];
	const corners = ["Square", "Rounded", "Dot"];
	const backgrounds = ["light", "dark", "transparent"];
	const patternGroup = dialog.getByRole("group", { name: "Module pattern" });
	const cornerGroup = dialog.getByRole("group", { name: "Corner style" });
	const backgroundGroup = dialog.getByRole("group", { name: "Export background" });
	const logoSwitch = dialog.getByRole("switch", { name: "Show logo" });
	const slider = dialog.getByRole("slider", { name: /Logo size/i });
	const pngButton = dialog.getByRole("button", { name: "PNG", exact: true });
	const svgButton = dialog.getByRole("button", { name: "SVG", exact: true });
	async function expectSafeExport() {
		await expect(dialog.getByText(/Scan check passed/)).toBeVisible({ timeout: 20_000 });
		await expect(pngButton).toBeEnabled();
		await expect(svgButton).toBeEnabled();
	}
	async function expectCheckedExport() {
		const passed = dialog.getByText(/Scan check passed/);
		const failed = dialog.getByText(/failed the scan check/);
		await expect(passed.or(failed)).toBeVisible({ timeout: 20_000 });
		if (await passed.isVisible()) {
			await expect(pngButton).toBeEnabled();
			await expect(svgButton).toBeEnabled();
		} else {
			await expect(pngButton).toBeDisabled();
			await expect(svgButton).toBeDisabled();
		}
	}

	await slider.fill("0");
	await logoSwitch.uncheck();
	await cornerGroup.getByRole("button", { name: "Square", exact: true }).click();
	await backgroundGroup.getByRole("button", { name: "light", exact: true }).click();
	for (const pattern of patterns) {
		await patternGroup.getByRole("button", { name: pattern, exact: true }).click();
		if (pattern === "Dots") await expectCheckedExport();
		else await expectSafeExport();
	}
	await logoSwitch.check();
	await patternGroup.getByRole("button", { name: "Classic", exact: true }).click();
	for (let index = 0; index < 5; index += 1) {
		await slider.fill(String(index));
		await expectSafeExport();
	}
	await slider.fill("0");
	for (const corner of corners) {
		await cornerGroup.getByRole("button", { name: corner, exact: true }).click();
		await expectSafeExport();
	}
	await cornerGroup.getByRole("button", { name: "Square", exact: true }).click();
	for (const background of backgrounds) {
		await backgroundGroup.getByRole("button", { name: background, exact: true }).click();
		await expectSafeExport();
	}

	await backgroundGroup.getByRole("button", { name: "light", exact: true }).click();
	await dialog.getByLabel("Background").fill("#06192f");
	await expect(dialog.getByText(/Increase foreground and background contrast/)).toBeVisible();
	await expect(pngButton).toBeDisabled();
	await expect(svgButton).toBeDisabled();
	await dialog.getByRole("button", { name: "Reset", exact: true }).click();
	await expectSafeExport();
	await patternGroup.getByRole("button", { name: "Classic", exact: true }).click();
	await cornerGroup.getByRole("button", { name: "Square", exact: true }).click();
	await slider.fill("0");
	await backgroundGroup.getByRole("button", { name: "transparent", exact: true }).click();
	await expectSafeExport();

	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);
	await dialog.evaluate((element) => { element.scrollTop = 0; });
	await page.screenshot({ path: testInfo.outputPath("shortlinks-qr-desktop.png"), fullPage: true });

	for (const size of [512, 1024, 2048]) {
		await dialog.getByLabel("Export size").selectOption(String(size));
		await expectSafeExport();

		const pngPromise = page.waitForEvent("download");
		await pngButton.click();
		const png = await pngPromise;
		expect(png.suggestedFilename()).toMatch(new RegExp(`-${size}\\.png$`));
		const pngPath = testInfo.outputPath(`shortlinks-qr-transparent-${size}.png`);
		await png.saveAs(pngPath);
		const pngData = await readFile(pngPath);
		const pngInfo = await page.evaluate(async ({ data, expectedSize }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${data}`;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas is unavailable.");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, expectedSize, expectedSize).data;
			let transparent = false;
			for (let index = 3; index < pixels.length; index += 4) {
				if (pixels[index] < 255) {
					transparent = true;
					break;
				}
			}
			return { width: image.naturalWidth, height: image.naturalHeight, transparent };
		}, { data: pngData.toString("base64"), expectedSize: size });
		expect(pngInfo).toEqual({ width: size, height: size, transparent: true });

		const svgPromise = page.waitForEvent("download");
		await svgButton.click();
		const svg = await svgPromise;
		expect(svg.suggestedFilename()).toMatch(new RegExp(`-${size}\\.svg$`));
		const svgPath = testInfo.outputPath(`shortlinks-qr-transparent-${size}.svg`);
		await svg.saveAs(svgPath);
		const svgText = await readFile(svgPath, "utf8");
		expect(svgText).toMatch(new RegExp(`width=["']${size}["']`));
		expect(svgText).toMatch(new RegExp(`height=["']${size}["']`));
		expect(svgText).not.toMatch(/(?:href|xlink:href)=["'](?:https?:|blob:|\/)/i);
	}

	const fullscreenButton = dialog.getByRole("button", { name: "Full screen" });
	await fullscreenButton.click();
	const fullscreen = page.getByRole("dialog", { name: /QR code for/ });
	await expect(fullscreen).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(fullscreen).toBeHidden();
	await expect(fullscreenButton).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);
	await dialog.evaluate((element) => { element.scrollTop = 0; });
	await page.screenshot({ path: testInfo.outputPath("shortlinks-qr-mobile-390.png"), fullPage: true });
	await page.setViewportSize({ width: 320, height: 700 });
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);

	const detailsTab = dialog.getByRole("tab", { name: "Details" });
	await detailsTab.focus();
	await detailsTab.press("ArrowRight");
	const statisticsTab = dialog.getByRole("tab", { name: "Statistics" });
	await expect(statisticsTab).toBeFocused();
	await expect(statisticsTab).toHaveAttribute("aria-selected", "true");
	await expect(dialog.getByRole("heading", { name: "Click trends" })).toBeVisible();

	await dialog.getByText("Filter statistics", { exact: true }).click();
	await dialog.getByLabel("Source").selectOption("qr");
	await dialog.getByLabel("Device").selectOption("mobile");
	await dialog.getByLabel("Timezone").fill("Asia/Manila");
	await dialog.getByRole("button", { name: "Week", exact: true }).click();
	await dialog.getByRole("button", { name: "Apply filters" }).click();
	const applied = dialog.getByLabel("Applied filters");
	await expect(applied).toContainText("Asia/Manila");
	await expect(applied).toContainText("Source: QR scans");
	await expect(applied).toContainText("Device: Mobile");
	await expect(applied).toContainText("By week");
	expect(reactKeyWarnings).toEqual([]);
});
