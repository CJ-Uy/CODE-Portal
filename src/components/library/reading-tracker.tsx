"use client";

import { useEffect, useRef } from "react";
import { createReadingTracker, type TrackerEvent } from "@/lib/library/activity-tracker";
import { sendActivity } from "./activity-ping";

const TICK_MS = 1000;
// Interactions fire many times a second; the tracker only needs the latest one, so feed at most once per second.
const INTERACT_THROTTLE_MS = 1000;

/**
 * Counts this visit: one "open" per mount, then the seconds the reader was really there (tab visible, something touched
 * in the last minute) every ~15 s and when the tab hides or the page goes away. Renders nothing.
 */
export function ReadingTracker({ itemId }: { itemId: string }): null {
	// React runs effects twice in development; this keeps that one open.
	const openedFor = useRef<string | null>(null);

	useEffect(() => {
		const tracker = createReadingTracker();
		const feed = (type: TrackerEvent["type"]) => {
			const seconds = tracker.feed({ type, at: Date.now() });
			if (seconds > 0) sendActivity(itemId, { kind: "active", seconds });
		};

		if (openedFor.current !== itemId) {
			openedFor.current = itemId;
			sendActivity(itemId, { kind: "open" });
		}

		let lastInteract = 0;
		const interact = () => {
			const now = Date.now();
			if (now - lastInteract < INTERACT_THROTTLE_MS) return;
			lastInteract = now;
			feed("interact");
		};
		// Coming back to the tab is something the reader just did, so it starts a fresh minute of activity.
		const show = () => {
			feed("visible");
			lastInteract = Date.now();
			feed("interact");
		};
		const hide = () => feed("hidden");

		if (document.visibilityState === "visible") show();
		const onVisibility = () => (document.visibilityState === "visible" ? show() : hide());
		// ponytail: scrolling and clicking inside a PDF preview happen in the iframe's own document, which the page cannot hear.
		// Focus moving into the iframe is heard (the window blurs), so the minute after the last click or focus is what counts.
		const onBlur = () => {
			if (document.activeElement instanceof HTMLIFrameElement) interact();
		};

		const passive = { passive: true, capture: true } as const;
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", hide);
		window.addEventListener("blur", onBlur);
		window.addEventListener("pointerdown", interact, passive);
		window.addEventListener("keydown", interact, passive);
		window.addEventListener("scroll", interact, passive);
		window.addEventListener("touchstart", interact, passive);
		const timer = window.setInterval(() => feed("tick"), TICK_MS);

		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("pointerdown", interact, passive);
			window.removeEventListener("keydown", interact, passive);
			window.removeEventListener("scroll", interact, passive);
			window.removeEventListener("touchstart", interact, passive);
			// Leaving through a link never fires pagehide; flush what has built up.
			hide();
		};
	}, [itemId]);

	return null;
}
