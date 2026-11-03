"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { loadMoreLibraryAction } from "@/app/portal/library/actions";
import { Button } from "@/components/ui/button";
import type { LibraryCardFields } from "@/lib/library/card-fields";
import { cn } from "@/lib/utils";
import { LibraryRow, LibraryRowHeader } from "./library-row";
import { clearRestoreRequest, readMemory, saveMemory, wantsRestore } from "./list-memory-client";
import { useSearchPending } from "./search-filters";

type Feed = { cards: LibraryCardFields[]; cursor: string | null; scrollY: number | null };

const subscribe = () => () => {};
const count = (n: number) => n.toLocaleString("en-US");

/**
 * The whole list as one sheet that keeps going. The page sends the first rows; the rest load as the member nears the
 * bottom (an observer on a marker below the rows), with a real Load more button for keyboards, screen readers and
 * browsers without the observer. `listKey` is the search's query string: the page remounts this with a new key when the
 * search changes, and the list is remembered under it when the member leaves, so Back returns to the same row.
 */
export function LibraryFeed({ listKey, cards, nextCursor, total }: { listKey: string; cards: LibraryCardFields[]; nextCursor: string | null; total: number }) {
	// False while hydrating a fresh page load (the server snapshot), true in a render that only ever happens in the browser.
	const browserOnly = useSyncExternalStore(subscribe, () => true, () => false);
	// Back, Forward or the breadcrumb: start from the remembered rows. Never while hydrating, so the server's render and this one agree.
	const [feed, setFeed] = useState<Feed>(() => {
		const memory = browserOnly && wantsRestore() ? readMemory() : null;
		return memory?.key === listKey ? { cards: memory.cards, cursor: memory.nextCursor, scrollY: memory.scrollY } : { cards, cursor: nextCursor, scrollY: null };
	});
	const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
	const [announcement, setAnnouncement] = useState("");
	const pending = useSearchPending();
	const sentinel = useRef<HTMLDivElement>(null);
	const busy = useRef(false);
	const latest = useRef(feed);
	const restoreTo = useRef(feed.scrollY);

	useEffect(() => {
		latest.current = feed;
	}, [feed]);

	useEffect(() => clearRestoreRequest(), []);

	// Put the member back on the row they left from, once the remembered rows are on the page. Instant, not the page's
	// smooth scrolling. If they left while a load was still coming, the page can be too short for that spot: the marker
	// is then in view, the next load starts at once, and this tries again when it lands. After that, loads never move the page.
	useLayoutEffect(() => {
		const y = restoreTo.current;
		if (y === null) return;
		window.scrollTo({ top: y, behavior: "instant" });
		if (Math.abs(window.scrollY - y) < 2 || !feed.cursor) restoreTo.current = null;
	}, [feed.cards.length, feed.cursor]);

	// Remember the list whenever a link on the page is followed (an item, a Latest card, the sidebar), with where it went.
	useEffect(() => {
		const remember = (event: MouseEvent) => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.origin !== window.location.origin) return;
			const { cards: kept, cursor } = latest.current;
			saveMemory({ key: listKey, to: link.pathname, cards: kept, nextCursor: cursor, scrollY: window.scrollY, savedAt: Date.now() });
		};
		document.addEventListener("click", remember, true);
		return () => document.removeEventListener("click", remember, true);
	}, [listKey]);

	async function loadMore() {
		const cursor = latest.current.cursor;
		if (busy.current || !cursor) return;
		busy.current = true;
		setStatus("loading");
		try {
			const page = await loadMoreLibraryAction(listKey, cursor);
			// One load at a time (busy), so the rows on screen are still the ones this load continues.
			const now = latest.current;
			const seen = new Set(now.cards.map((card) => card.id));
			const shown = [...now.cards, ...page.cards.filter((card) => !seen.has(card.id))];
			setFeed({ ...now, cards: shown, cursor: page.nextCursor });
			setAnnouncement(page.nextCursor ? `Showing ${count(shown.length)} of ${count(total)}` : `Showing all ${count(total)}`);
			setStatus("idle");
		} catch {
			setStatus("failed");
		} finally {
			busy.current = false;
		}
	}

	const nearBottom = useEffectEvent(() => void loadMore());
	// A fresh observer after every load: if the marker is still in view (short rows, a tall screen), its first report loads again.
	useEffect(() => {
		const marker = sentinel.current;
		if (!marker || !feed.cursor || status !== "idle" || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && nearBottom(), { rootMargin: "800px 0px" });
		observer.observe(marker);
		return () => observer.disconnect();
	}, [feed.cursor, feed.cards.length, status]);

	return (
		<div aria-busy={pending || status === "loading"} className={cn("grid min-w-0 rounded-xl border border-border bg-card transition-opacity", pending && "opacity-60")}>
			<LibraryRowHeader />
			<ul aria-label="Library items" className="grid min-w-0 divide-y divide-border">
				{feed.cards.map((card) => (
					<LibraryRow key={card.id} card={card} />
				))}
			</ul>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			<div ref={sentinel} className="grid min-h-16 place-items-center border-t border-border px-3 py-4 text-sm text-muted-foreground">
				{status === "loading" ? (
					<p className="inline-flex items-center gap-2">
						<LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
						Loading more...
					</p>
				) : status === "failed" ? (
					<p className="flex flex-wrap items-center justify-center gap-3">
						Could not load more items.
						<Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()}>
							Try again
						</Button>
					</p>
				) : feed.cursor ? (
					<Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()}>
						Load more
						<span className="sr-only">
							{" "}
							items, {count(feed.cards.length)} of {count(total)} shown
						</span>
					</Button>
				) : (
					<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
						<p>
							You&apos;ve reached the end. {count(total)} {total === 1 ? "item" : "items"}.
						</p>
						<Button
							type="button"
							variant="ghost"
							className="min-h-11"
							onClick={() => {
								window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
								document.getElementById("library-title")?.focus({ preventScroll: true });
							}}
						>
							<ArrowUp aria-hidden />
							Back to top
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
