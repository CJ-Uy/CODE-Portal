import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
		},
	},
	test: {
		environment: "node",
		include: ["src/app/portal/calendar/[eventId]/event-manage-panel.test.ts", "src/app/portal/calendar/events-list.test.ts", "src/components/links/links-workspace.test.ts"],
	},
});
