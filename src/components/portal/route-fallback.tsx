"use client";

import { usePathname } from "next/navigation";

/**
 * A section's loading.tsx is also the outer fallback for every page below it. On a full load of a
 * deep link (a form opened from an email, say) that outer fallback shows first, and an overview-
 * shaped skeleton there reads as the wrong page. This shows the overview skeleton only on the
 * overview itself and a neutral one everywhere else. Both are rendered on the server, so the
 * choice costs no skeleton markup in the client bundle.
 */
export function RouteFallback({ path, match, other }: { path: string; match: React.ReactNode; other: React.ReactNode }) {
	return usePathname() === path ? match : other;
}
