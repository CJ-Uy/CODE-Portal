import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// v1 caching posture, master plan section 13: `/` is static at build,
// `/portal/*` and `/[slug]` are force-dynamic, so there is no ISR
// revalidation surface that needs a shared incremental cache. The default
// in-Worker cache is sufficient. Revisit R2 incremental cache only if a
// future phase introduces ISR or on-demand revalidation.
export default defineCloudflareConfig({});
