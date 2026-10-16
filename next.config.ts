import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	allowedDevOrigins: ["127.0.0.1"],
	output: "standalone",
	outputFileTracingRoot: import.meta.dirname,
	// Retention history used to live at /portal/events. Temporary, so browsers do not
	// cache it in case /portal/events is reused for a real events page.
	async redirects() {
		return [{ source: "/portal/events", destination: "/portal/retention", permanent: false }];
	},
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.E2E_AUTH_BYPASS !== "1") initOpenNextCloudflareForDev();
