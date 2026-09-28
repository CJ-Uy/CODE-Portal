import { authContract } from "@/db/contract/auth";
import { getAppConfig } from "@/server/env";
import type { Actor } from "./permissions";

export async function getActor(): Promise<Actor | null> {
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
}

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
