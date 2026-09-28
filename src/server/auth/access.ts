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
