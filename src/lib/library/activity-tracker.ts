import { ACTIVITY } from "./activity";

export type TrackerEvent = { type: "interact" | "visible" | "hidden" | "tick"; at: number };

/**
 * DOM-free reading timer. Time counts only while the page is visible and within `idleMs` of the last
 * interaction; `feed` returns whole seconds to send now (0 = nothing). Sub-second remainders carry over.
 */
export function createReadingTracker(): { feed(event: TrackerEvent): number } {
	let visible = false;
	let lastAt = 0;
	let lastInteract: number | null = null;
	let accruedMs = 0;

	const take = () => {
		const seconds = Math.floor(accruedMs / 1000);
		accruedMs -= seconds * 1000;
		return seconds;
	};

	return {
		feed({ type, at }) {
			// The state in force since the previous event decides whether the gap counts.
			if (visible && lastInteract !== null) {
				const end = Math.min(at, lastInteract + ACTIVITY.idleMs);
				accruedMs += Math.max(0, end - lastAt);
			}
			lastAt = Math.max(lastAt, at);

			if (type === "visible") visible = true;
			else if (type === "hidden") visible = false;
			else if (type === "interact") lastInteract = at;

			if (type === "hidden") return take();
			if (type === "tick" && accruedMs >= ACTIVITY.pingIntervalMs) return take();
			return 0;
		},
	};
}
