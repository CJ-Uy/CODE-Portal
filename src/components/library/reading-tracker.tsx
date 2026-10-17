"use client";

import { useEffect, useRef } from "react";
import { createFrameFocus, createReadingTracker, type TrackerEvent } from "@/lib/library/activity-tracker";
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
		const frame = createFrameFocus();
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
		const hide = () => feed("hidden");

		// Opening the page counts as the first touch. Coming back to the tab does not: it needs a real one.
		if (document.visibilityState === "visible") {
			feed("visible");
			interact();
		}
		const onVisibility = () => (document.visibilityState === "visible" ? feed("visible") : hide());

		const passive = { passive: true, capture: true } as const;
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", hide);
		window.addEventListener("pointerdown", interact, passive);
		window.addEventListener("keydown", interact, passive);
		window.addEventListener("scroll", interact, passive);
		window.addEventListener("touchstart", interact, passive);
		const timer = window.setInterval(() => {
			// ponytail: PDF scrolling happens in the iframe's own document, which the page cannot hear. Focus resting in the preview
			// (with the browser window focused) stands in for interaction, at most 5 min per entry (+ the 60 s idle tail). Wheel-scrolling
			// without ever clicking is still unheard; hosting the PDF with pdf.js is the upgrade.
			const inFrame = document.activeElement instanceof HTMLIFrameElement && document.hasFocus();
			if (frame.counts(inFrame, Date.now())) feed("interact");
			feed("tick");
		}, TICK_MS);

		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", hide);
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
