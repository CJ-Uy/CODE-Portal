import { cache } from "react";
import { authContract } from "@/db/contract/auth";
import { getAppConfig } from "@/server/env";
import type { Actor } from "./permissions";

/**
 * Memoized per server render. The portal layout, a nested layout, the page and each Suspense
 * child all ask for the actor, and every uncached call is a fresh session lookup on D1.
 * Outside a render (route handlers, server actions) `cache` passes straight through.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
	const config = getAppConfig();
	if (config.APP_ENV === "shared") {
		return getSharedActor(config.SHARED_API_BASE_URL, config.SHARED_API_TOKEN);
	}

	const { auth } = await import("@/auth");
	const session = await auth();
	if (!session?.user?.id || session.user.status !== "active") return null;

	return {
		memberId: session.user.id,
		roles: session.user.roles,
		context: "session",
	};
});

export async function requireActor(): Promise<Actor> {
	const actor = await getActor();
	if (!actor) throw new Error("Authentication required.");
	return actor;
}

async function getSharedActor(baseUrl?: string, token?: string): Promise<Actor | null> {
	if (!baseUrl || !token) return null;

	const response = await fetch(new URL("/internal/auth", baseUrl), {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (response.status === 401 || response.status === 404) return null;
	if (!response.ok) throw new Error("Shared API failed to resolve the current actor.");

	const { actor } = authContract.actor.output.parse(await response.json());
	return actor;
}
