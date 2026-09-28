import { getAppConfig, type AppConfig } from "./env";

/**
 * Product surfaces that are finished on beta but not yet ready for staging or production.
 *
 * `leaderboard` is a sub-surface of `retention`, not a peer: it only renders on the points
 * page, so enabling it while retention is off does nothing. It is separate because the
 * points page is wanted without the ranking table.
 */
export const FEATURE_KEYS = [
	"retention",
	"library",
	"announcements",
	"notifications",
	"surveys",
	"publicSite",
	"leaderboard",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureFlags = Record<FeatureKey, boolean>;

/** Split from getFeatureFlags so it stays testable without a Worker env in scope. */
export function featureFlagsFromConfig(config: AppConfig): FeatureFlags {
	return {
		retention: config.FEATURE_RETENTION,
		library: config.FEATURE_LIBRARY,
		announcements: config.FEATURE_ANNOUNCEMENTS,
		notifications: config.FEATURE_NOTIFICATIONS,
		surveys: config.FEATURE_SURVEYS,
		publicSite: config.FEATURE_PUBLIC_SITE,
		leaderboard: config.FEATURE_LEADERBOARD,
	};
}

export function getFeatureFlags(): FeatureFlags {
	return featureFlagsFromConfig(getAppConfig());
}

export function isFeatureEnabled(key: FeatureKey): boolean {
	return getFeatureFlags()[key];
}

/** Raised by assertFeatureEnabled so callers can map a disabled surface to a 404. */
export class FeatureDisabledError extends Error {
	constructor(public readonly key: FeatureKey) {
		super(`Feature "${key}" is disabled in this environment.`);
		this.name = "FeatureDisabledError";
	}
}

/**
 * Guards a server action or route handler. Pages should prefer `isFeatureEnabled` plus
 * Next's `notFound()`, which renders the real 404 instead of an error boundary.
 */
export function assertFeatureEnabled(key: FeatureKey): void {
	if (!isFeatureEnabled(key)) throw new FeatureDisabledError(key);
}
