import { describe, expect, it } from "vitest";
import { featureFlagSchema } from "./env";
import { FEATURE_KEYS, featureFlagsFromConfig, FeatureDisabledError } from "./features";

const BASE = {
	APP_ENV: "local",
	STORAGE_MODE: "local",
	LOCAL_SQLITE_PATH: "./.local/dev.db",
	LOCAL_STORAGE_DIR: "./.local/uploads",
} as const;

function configWith(flags: Partial<Record<string, boolean>>) {
	return {
		...BASE,
		FEATURE_RETENTION: false,
		FEATURE_LIBRARY: false,
		FEATURE_ANNOUNCEMENTS: false,
		FEATURE_NOTIFICATIONS: false,
		FEATURE_SURVEYS: false,
		FEATURE_PUBLIC_SITE: false,
		FEATURE_LEADERBOARD: false,
		...flags,
	} as Parameters<typeof featureFlagsFromConfig>[0];
}

describe("release feature flags", () => {
	it("enables only the literal true string", () => {
		expect(featureFlagSchema.parse("true")).toBe(true);
		expect(featureFlagSchema.parse("false")).toBe(false);
		expect(featureFlagSchema.parse("TRUE")).toBe(false);
		expect(featureFlagSchema.parse("1")).toBe(false);
		expect(featureFlagSchema.parse("")).toBe(false);
		expect(featureFlagSchema.parse(undefined)).toBe(false);
	});

	it("defaults every surface to off", () => {
		const flags = featureFlagsFromConfig(configWith({}));
		for (const key of FEATURE_KEYS) expect(flags[key]).toBe(false);
	});

	it("maps each config field to its own key", () => {
		expect(featureFlagsFromConfig(configWith({ FEATURE_LIBRARY: true })).library).toBe(true);
		expect(featureFlagsFromConfig(configWith({ FEATURE_LIBRARY: true })).announcements).toBe(false);
		expect(featureFlagsFromConfig(configWith({ FEATURE_PUBLIC_SITE: true })).publicSite).toBe(true);
		expect(featureFlagsFromConfig(configWith({ FEATURE_SURVEYS: true })).surveys).toBe(true);
		expect(featureFlagsFromConfig(configWith({ FEATURE_LEADERBOARD: true })).leaderboard).toBe(true);
		// leaderboard is independent of retention in config; the points page is what pairs them.
		expect(featureFlagsFromConfig(configWith({ FEATURE_LEADERBOARD: true })).retention).toBe(false);
	});

	it("names the offending surface when a guard rejects", () => {
		const error = new FeatureDisabledError("library");
		expect(error.key).toBe("library");
		expect(error.message).toContain("library");
	});
});
