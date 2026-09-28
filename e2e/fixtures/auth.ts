import type { Page } from "@playwright/test";

export type SeededRole = "admin" | "member";

const SEEDED_EMAIL: Record<SeededRole, string> = {
	admin: "admin@example.com",
	member: "member@example.com",
};

export async function signInAs(page: Page, role: SeededRole): Promise<void> {
	const response = await page.request.post("/api/auth/e2e", { data: { email: SEEDED_EMAIL[role] } });
	if (!response.ok()) throw new Error(`E2E sign-in failed: ${response.status()} ${await response.text()}`);
	await page.goto("/portal");
}
