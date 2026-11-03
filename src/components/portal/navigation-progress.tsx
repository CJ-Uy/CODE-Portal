"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar along the top edge while a navigation is in flight. A new page segment already gets
 * its loading.tsx skeleton, but a click that only changes the query (a tab, a filter, a page
 * number) keeps the old page on screen until the new one is ready, and that is the click that
 * felt dead. The bar starts on a same-origin link click or GET form submit, and finishes once the
 * URL moves off the one it started from. A navigation that never lands is cleared after a while.
 */
export function NavigationProgress() {
	const url = `${usePathname()}?${useSearchParams().toString()}`;
	const [startedAt, setStartedAt] = useState<string | null>(null);
	const state = startedAt === null ? "idle" : startedAt === url ? "loading" : "done";

	// "done" only needs to outlive the fade. "loading" gives up on a navigation that never lands.
	useEffect(() => {
		if (state === "idle") return;
		const timer = window.setTimeout(() => setStartedAt(null), state === "done" ? 300 : 15000);
		return () => window.clearTimeout(timer);
	}, [state]);

	useEffect(() => {
		function start(target: URL) {
			const here = window.location;
			if (target.origin !== here.origin) return;
			if (target.pathname === here.pathname && target.search === here.search) return;
			setStartedAt(`${here.pathname}?${new URLSearchParams(here.search).toString()}`);
		}
		function onClick(event: MouseEvent) {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = (event.target as Element | null)?.closest?.("a[href]");
			if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
			if (anchor.target && anchor.target !== "_self") return;
			start(new URL(anchor.href));
		}
		function onSubmit(event: SubmitEvent) {
			const form = event.target;
			if (!(form instanceof HTMLFormElement) || form.method !== "get") return;
			const target = new URL(form.action);
			const query = new URLSearchParams();
			for (const [key, value] of new FormData(form, event.submitter)) if (typeof value === "string") query.append(key, value);
			target.search = query.toString();
			start(target);
		}
		document.addEventListener("click", onClick, true);
		document.addEventListener("submit", onSubmit, true);
		return () => {
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("submit", onSubmit, true);
		};
	}, []);

	if (state === "idle") return null;
	// The styles live in globals.css (.nav-progress): it fades in only after a beat, so a fast
	// navigation never flashes it, and fills then fades on "done".
	return <div aria-hidden data-state={state} className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-ring" />;
}
