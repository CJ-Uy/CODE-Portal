import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const LOCAL_SQLITE_PATH = resolve(".local/dev.db");

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `next dev --port ${PORT}`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			APP_ENV: "local",
			APP_BASE_URL: `http://127.0.0.1:${PORT}`,
			AUTH_SECRET: "e2e-test-secret-not-for-production",
			AUTH_URL: `http://127.0.0.1:${PORT}`,
			AUTH_GOOGLE_ID: "e2e-google-client-id",
			AUTH_GOOGLE_SECRET: "e2e-google-client-secret",
			E2E_AUTH_BYPASS: "1",
			LOCAL_SQLITE_PATH,
		},
	},
});
