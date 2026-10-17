import { describe, expect, it } from "vitest";
import {
	getGoogleAuthorizationParams,
	getGoogleProviderOptions,
	getRosterDeniedRedirect,
	getSignInReturnPath,
	isGoogleSignInAllowed,
} from "./access";

const policy = {
	allowedDomains: ["ateneo.edu"],
};

describe("Google sign-in policy", () => {
	it("builds a member access page URL with the attempted email", () => {
		expect(getRosterDeniedRedirect(" Person+Guest@Example.com ")).toBe(
			"/signin?error=NotMember&email=person%2Bguest%40example.com",
		);
	});

	it("forces Google account selection only after a non-member sign-in", () => {
		expect(getGoogleAuthorizationParams("NotMember")).toEqual({ prompt: "select_account" });
		expect(getGoogleAuthorizationParams()).toBeUndefined();
	});

	it("allows verified Google accounts to link to pre-created members", () => {
		expect(getGoogleProviderOptions("client-id", "client-secret")).toEqual({
			clientId: "client-id",
			clientSecret: "client-secret",
			allowDangerousEmailAccountLinking: true,
		});
	});

	it("never pins the account chooser to one hosted domain", () => {
		expect(getGoogleProviderOptions("client-id", "client-secret")).not.toHaveProperty("authorization");
	});

	it("allows a verified email from an allowed domain", () => {
		expect(
			isGoogleSignInAllowed(
				{ provider: "google", email: "member@ateneo.edu", emailVerified: true },
				policy,
			),
		).toBe(true);
	});

	it("allows any verified Google email when no domains are configured", () => {
		expect(
			isGoogleSignInAllowed(
				{ provider: "google", email: "OFFICER@gmail.com", emailVerified: true },
				{ allowedDomains: [] },
			),
		).toBe(true);
	});

	it("allows the verified bootstrap email outside configured domains", () => {
		expect(
			isGoogleSignInAllowed(
				{ provider: "google", email: " Bootstrap@Example.com ", emailVerified: true },
				{ allowedDomains: ["ateneo.edu"], bootstrapEmail: "bootstrap@example.com" },
			),
		).toBe(true);
	});

	it.each([
		{ provider: "github", email: "member@ateneo.edu", emailVerified: true },
		{ provider: "google", email: "member@ateneo.edu", emailVerified: false },
		{ provider: "google", email: "bootstrap@example.com", emailVerified: false },
		{ provider: "google", email: "outsider@example.com", emailVerified: true },
		{ provider: "google", email: null, emailVerified: true },
	])("rejects an ineligible profile", (profile) => {
		expect(isGoogleSignInAllowed(profile, { ...policy, bootstrapEmail: "bootstrap@example.com" })).toBe(false);
	});
});

describe("sign-in return path", () => {
	it.each([
		["/portal", "/portal"],
		["/portal/surveys/survey_1", "/portal/surveys/survey_1"],
		["/portal/library?q=hello%20world&tag=a", "/portal/library?q=hello%20world&tag=a"],
		["/events/K7P2QM", "/events/K7P2QM"],
		["/portal/admin/../surveys/x", "/portal/surveys/x"],
	])("returns %s to %s", (next, expected) => {
		expect(getSignInReturnPath(next)).toBe(expected);
	});

	it.each([
		undefined,
		null,
		"",
		["/portal/surveys/x"],
		"portal/surveys/x",
		"https://evil.example/portal",
		"javascript:alert(1)",
		"//evil.example/portal",
		"/\\evil.example/portal",
		"/portal\\..\\..\\api",
		"/\t/evil.example/portal",
		"/\n/evil.example",
		"/portal /x",
		"/",
		"/signin",
		"/api/auth/signout",
		"/portalx",
		"/portal/../api/auth/signout",
		"/portal/%2e%2e/api/auth/signout",
		"/eventsx/K7P2QM",
	])("falls back to /portal for %j", (next) => {
		expect(getSignInReturnPath(next)).toBe("/portal");
	});
});
