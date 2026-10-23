"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { listHref } from "@/lib/library/list-memory";
import { readMemory, requestRestore } from "./list-memory-client";

const subscribe = () => () => {};
/** The remembered list's search and the page it was left for, as one string so the snapshot compares equal between reads. */
function rememberedRoute(): string | null {
	const memory = readMemory();
	return memory ? JSON.stringify([memory.key, memory.to]) : null;
}

/**
 * "Library", leading back to the list the member left: same search, same row. From the very page they opened from the
 * list it is a real Back, so the browser's history stays tidy; from anywhere else it opens that list and asks it to restore.
 * The server and the first render link to the plain library, so nothing differs at hydration.
 */
export function BackToLibrary({ className }: { className?: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const route = useSyncExternalStore(subscribe, rememberedRoute, () => null);
	const [key, to] = route ? (JSON.parse(route) as [string, string]) : ["", ""];

	return (
		<Link
			href={listHref(key)}
			className={className}
			onClick={(event) => {
				if (!route || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				// A tab opened straight onto this page copies the memory but has no list behind it to go back to.
				if (to === pathname && window.history.length > 1) {
					event.preventDefault();
					router.back();
				} else {
					requestRestore();
				}
			}}
		>
			Library
		</Link>
	);
}
