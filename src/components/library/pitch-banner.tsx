"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "library-pitch-dismissed";

// The server and the first client render always show the banner, so it never flashes for a member who has not dismissed it.
// Right after hydration the stored choice hides it. When storage is blocked, the choice lasts until the page is reloaded.
let dismissedThisSession = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener("storage", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

function isDismissed(): boolean {
	if (dismissedThisSession) return true;
	try {
		return window.localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

function dismiss(): void {
	dismissedThisSession = true;
	try {
		window.localStorage.setItem(KEY, "1");
	} catch {
		// Blocked storage: the in-memory flag above still hides it for now.
	}
	listeners.forEach((listener) => listener());
}

export function PitchBanner() {
	const dismissed = useSyncExternalStore(subscribe, isDismissed, () => false);
	if (dismissed) return null;

	return (
		<section aria-labelledby="library-pitch-title" className="relative min-w-0 rounded-xl border border-border bg-secondary/50 py-4 pl-4 pr-14">
			<p className="text-xs font-semibold uppercase text-primary">Toward a public library</p>
			<h2 id="library-pitch-title" className="mt-1 font-heading text-lg leading-snug">
				Most advice online is written for businesses, not student organizations.
			</h2>
			<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
				This library is where CODE keeps what it has learned. We hope it can become a reliable resource for youth orgs everywhere.
			</p>
			<Link href="/portal/library/about" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
				Read the idea
			</Link>
			<Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss" className="absolute right-1 top-1 size-11">
				<X className="size-4" aria-hidden />
			</Button>
		</section>
	);
}
