import type { FeatureFlags } from "@/server/features";

/**
 * Nav filtering lives here, apart from nav-items, because nav-items carries the lucide
 * icon components. The Workers test pool cannot resolve React, so importing the icons
 * into a test fails; this module stays icon-free and therefore testable.
 */
export type FeatureGated = { id: string; feature?: keyof FeatureFlags };

function visible(item: FeatureGated, flags: FeatureFlags): boolean {
	return !item.feature || flags[item.feature];
}

/**
 * Keeps the list at its original length. The mobile bar renders the primary entries as
 * 2 + FAB + 2, so a hidden slot is swapped for the fallback rather than dropped, which
 * would leave the bar lopsided around the FAB.
 */
export function withFallback<T extends FeatureGated>(items: T[], fallback: T | undefined, flags: FeatureFlags): T[] {
	return items.map((item) => (visible(item, flags) ? item : (fallback ?? item)));
}

/** Drops flagged-off entries, plus any id the primary list already backfilled with. */
export function withoutHidden<T extends FeatureGated>(items: T[], takenIds: Set<string>, flags: FeatureFlags): T[] {
	return items.filter((item) => visible(item, flags) && !takenIds.has(item.id));
}
