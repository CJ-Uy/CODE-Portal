import { ACTIVITY } from "./activity";

export type TrackerEvent = { type: "interact" | "visible" | "hidden" | "tick"; at: number };

/** How long focus resting in the PDF preview stands in for interaction, per time focus entered it. */
export const PDF_FOCUS_MS = 5 * 60_000;

/**
 * Scrolling and clicking inside a PDF preview happen in the iframe's own document, which the page cannot hear. Focus resting
 * in the preview (while the browser window itself has focus) stands in for it. Call once a tick with whether that is true
 * now: it answers whether to count an interaction, for at most `PDF_FOCUS_MS` after focus entered the preview. Leaving it,
 * or the window losing focus, ends the entry; coming back starts a new one. The tracker's own 60 s idle tail comes on top.
 */
export function createFrameFocus(): { counts(inFrame: boolean, at: number): boolean } {
	let since: number | null = null;
	return {
		counts(inFrame, at) {
			since = inFrame ? (since ?? at) : null;
			return since !== null && at - since < PDF_FOCUS_MS;
		},
	};
}

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
