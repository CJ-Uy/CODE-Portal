/** Pure helpers for the list page: the order the editor shows, and the small "2d ago" label. */

/** The same array with the entry at `from` moved to `to`. Out-of-range or unchanged moves return the input itself. */
export function moveItem<T>(order: readonly T[], from: number, to: number): readonly T[] {
	if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
	const next = [...order];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

/** "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "2y ago". A date in the future reads as just now. */
export function relativeAge(date: Date, now: Date): string {
	const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

/** What closes a sentence that ends with free text: nothing when it already ends in punctuation, otherwise a full stop. */
export function fullStopFor(text: string): string {
	return /[.!?]$/.test(text.trim()) ? "" : ".";
}
