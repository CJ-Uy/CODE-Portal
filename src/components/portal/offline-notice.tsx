"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

/**
 * A pill along the top while the device has no connection. Event check-ins happen on phones on
 * venue Wi-Fi, where a save that silently fails reads exactly like a slow one. The server render
 * always assumes online, so the pill only ever appears after hydration.
 */
export function OfflineNotice() {
	const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
	if (online) return null;
	return (
		<div role="status" className="pointer-events-none fixed inset-x-0 top-2 z-[90] flex justify-center px-4">
			<p className="toast-enter flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
				<WifiOff className="size-4 shrink-0" aria-hidden />
				You are offline. Changes will not save until you reconnect.
			</p>
		</div>
	);
}
