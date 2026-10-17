export type GoogleSignInProfile = {
	provider: string | null | undefined;
	email: string | null | undefined;
	emailVerified: boolean;
};

export type AuthAccessPolicy = {
	allowedDomains: string[];
	bootstrapEmail?: string;
};

export function isGoogleSignInAllowed(
	profile: GoogleSignInProfile,
	policy: AuthAccessPolicy,
): boolean {
	if (profile.provider !== "google" || !profile.emailVerified || !profile.email) return false;

	const email = profile.email.trim().toLowerCase();
	const domain = email.split("@").at(1);
	const allowedDomains = policy.allowedDomains.map((item) => item.trim().toLowerCase()).filter(Boolean);
	const bootstrapEmail = policy.bootstrapEmail?.trim().toLowerCase();

	return email === bootstrapEmail || allowedDomains.length === 0 || Boolean(domain && allowedDomains.includes(domain));
}

export function splitAuthList(value?: string): string[] {
	return value
		?.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean) ?? [];
}

export function getRosterDeniedRedirect(email: string): string {
	const params = new URLSearchParams({
		error: "NotMember",
		email: email.trim().toLowerCase(),
	});
	return `/signin?${params}`;
}

// Server components cannot read the request path, so src/middleware.ts copies it into
// this header for the signed-out redirect to carry along as `next`.
export const PORTAL_PATH_HEADER = "x-portal-path";

// /events/<code> is the share-link resolver, which already sends signed-out
// visitors to /signin?next=/events/<code>.
const SIGN_IN_RETURN_PREFIXES = ["/portal", "/events"];
const SIGN_IN_FALLBACK = "/portal";

/**
 * Where to send a member after sign-in. `next` arrives in the URL, so this is an
 * open-redirect boundary: only same-origin paths under /portal or /events pass,
 * and anything else falls back to /portal.
 */
export function getSignInReturnPath(next: unknown): string {
	// Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" or
	// "/\t/evil.com" would become a protocol-relative URL to another host.
	if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(next)) {
		return SIGN_IN_FALLBACK;
	}

	// Resolve against a throwaway origin so ".." and "%2e%2e" segments are
	// collapsed before the prefix check, then redirect to what was checked.
	const base = "https://next.invalid";
	const url = new URL(next, base);
	if (url.origin !== base) return SIGN_IN_FALLBACK;
	const allowed = SIGN_IN_RETURN_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
	return allowed ? `${url.pathname}${url.search}${url.hash}` : SIGN_IN_FALLBACK;
}

export function getGoogleAuthorizationParams(error?: string): Record<string, string> | undefined {
	return error === "NotMember" ? { prompt: "select_account" } : undefined;
}

// No `hd` param on purpose. `hd` accepts a single hosted domain, so it would
// have pinned the account chooser to allowedDomains[0] and hidden every other
// account — including @student.ateneo.edu and personal accounts we do allow.
// isGoogleSignInAllowed plus the roster gate are the real boundary anyway.
export function getGoogleProviderOptions(clientId: string | undefined, clientSecret: string | undefined) {
	return {
		clientId,
		clientSecret,
		// Safe because the sign-in callback accepts only Google profiles with a verified email.
		allowDangerousEmailAccountLinking: true,
	};
}
