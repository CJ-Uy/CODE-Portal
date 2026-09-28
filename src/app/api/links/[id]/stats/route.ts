import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { createLinksHandlers } from "@/server/links/handlers";
import { proxySharedApiRequest } from "@/server/shared-api";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	const config = getAppConfig();
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, `/internal/links/${encodeURIComponent(id)}/stats`);
	return createLinksHandlers({ getActor, getRepositories }).stats(request, id);
}
