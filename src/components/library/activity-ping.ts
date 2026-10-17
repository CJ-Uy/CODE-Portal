export type ActivityPing = { kind: "open" | "active" | "download"; seconds?: number };

/**
 * Fire-and-forget POST to the item's activity route. `sendBeacon` survives the page closing; it is a Blob so the content
 * type is JSON. When it is missing or refuses (queue full), `fetch` with `keepalive` does the same job. A lost ping costs a few seconds.
 */
export function sendActivity(itemId: string, ping: ActivityPing): void {
	const url = `/api/library/${encodeURIComponent(itemId)}/activity`;
	const body = JSON.stringify(ping);
	try {
		if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
	} catch {
		// Fall through to fetch.
	}
	void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
}
