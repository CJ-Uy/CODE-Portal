import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
		},
	},
	plugins: [
		cloudflareTest(async () => ({
			main: "./src/test-worker.ts",
			miniflare: {
				compatibilityDate: "2026-06-10",
				compatibilityFlags: ["nodejs_compat"],
				d1Databases: {
					DB: "code-portal-test-db",
				},
				bindings: {
					APP_ENV: "production",
					DEPLOY_ENV: "dev",
					STORAGE_MODE: "local",
					AUTH_SECRET: "test-auth-secret",
					AUTH_GOOGLE_ID: "test-google-id",
					AUTH_GOOGLE_SECRET: "test-google-secret",
					AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL: "bootstrap@example.com",
					// Tests cover beta behaviour, where every surface is on. The fail-closed
					// default is asserted directly in src/server/features.test.ts instead.
					FEATURE_RETENTION: "true",
					FEATURE_LIBRARY: "true",
					FEATURE_ANNOUNCEMENTS: "true",
					FEATURE_NOTIFICATIONS: "true",
					FEATURE_SURVEYS: "true",
					FEATURE_PUBLIC_SITE: "true",
					FEATURE_EMAIL: "true",
					FEATURE_MENTS: "true",
					EMAIL_INBOX_ADDRESS: "beta-inbox@ateneocode.org",
					EMAIL_PUBLIC_BASE_URL: "https://beta.ateneocode.org",
					EMAIL_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-0123456789",
					TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "drizzle/migrations")),
				},
			},
		})),
	],
	test: {
		globals: false,
		include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
		exclude: ["src/app/portal/calendar/[eventId]/event-manage-panel.test.ts", "src/app/portal/calendar/events-list.test.ts", "src/components/links/links-workspace.test.ts"],
		setupFiles: ["./src/test/setup-d1.ts"],
	},
});
