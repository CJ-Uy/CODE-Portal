export const RESERVED_SLUG_DEFAULTS = ["portal", "admin", "api", "l", "signin", "internal", "contact", "product", "projects", "services", "unsubscribe", "favicon.ico", "robots.txt", "sitemap.xml", "_next"] as const;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const MOBILE_PATTERN = /Mobi|Android|iPhone|iPad|iPod/i;

export function normalizeSlug(raw: string): string {
	return raw.trim().toLowerCase().replace(/^\//, "");
}

export function isValidSlugFormat(slug: string): boolean {
	if (slug.length < 3 || slug.length > 32) return false;
	if (slug.includes("--")) return false;
	return SLUG_PATTERN.test(slug);
}

export function isValidDestinationUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function deviceBucket(userAgent: string | null): "mobile" | "desktop" {
	if (!userAgent) return "desktop";
	return MOBILE_PATTERN.test(userAgent) ? "mobile" : "desktop";
}
