import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

/** The decision itself, split out so it tests without a Worker env in scope. */
export function archiveAccess(actor: Actor | null, surveysEnabled: boolean): boolean {
	return surveysEnabled && can(actor, "survey:configure") && can(actor, "retention:record");
}

/**
 * Whether to offer the "See feedback from past <type> events" link on the event forms.
 * The archive page requires retention:record and its feedback columns need survey:configure
 * with surveys on, so the link needs all three. The page re-checks on arrival; this only
 * decides whether to offer the link.
 */
export function canViewFeedbackArchive(actor: Actor | null): boolean {
	return archiveAccess(actor, isFeatureEnabled("surveys"));
}
