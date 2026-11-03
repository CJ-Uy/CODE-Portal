import { LIST_MEMORY_KEY, readListMemory, writeListMemory } from "@/lib/library/list-memory";
import type { ListMemory } from "@/lib/library/list-memory";

// The browser side of the list memory. Storage can be blocked (a private window, cleared site data), so every touch
// is wrapped: without it the list simply opens from the top.

const RESTORE_KEY = "library-list-restore";
// A Back or Forward that landed in the last few seconds. Registered when this module first loads, which is on the
// library list or on any page that links back to it, so the popstate that returns to the list is always heard.
let poppedAt = 0;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (poppedAt = Date.now()));

export function readMemory(): ListMemory | null {
	try {
		return readListMemory(window.sessionStorage.getItem(LIST_MEMORY_KEY), Date.now());
	} catch {
		return null;
	}
}

export function saveMemory(memory: ListMemory): void {
	try {
		const raw = writeListMemory(memory);
		if (raw) window.sessionStorage.setItem(LIST_MEMORY_KEY, raw);
		else window.sessionStorage.removeItem(LIST_MEMORY_KEY);
	} catch {
		// Blocked or full storage: coming back opens the list from the top.
	}
}

/** Asked for by the breadcrumb's Library link, so the list it opens picks up where the member was. */
export function requestRestore(): void {
	try {
		window.sessionStorage.setItem(RESTORE_KEY, "1");
	} catch {
		// See saveMemory.
	}
}

/** Whether the list now opening should restore: it was reached by Back or Forward, or the breadcrumb asked. Only reads. */
export function wantsRestore(): boolean {
	if (Date.now() - poppedAt < 3_000) return true;
	try {
		return window.sessionStorage.getItem(RESTORE_KEY) === "1";
	} catch {
		return false;
	}
}

/** The list has opened: a breadcrumb's request is used up either way. */
export function clearRestoreRequest(): void {
	try {
		window.sessionStorage.removeItem(RESTORE_KEY);
	} catch {
		// See saveMemory.
	}
}
