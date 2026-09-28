import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createLinksInternalHandlers } from "@/server/internal/links";

type Context = { params: Promise<{ id: string }> };

function getHandlers() {
	const config = getAppConfig();
	return createLinksInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().stats(request, id);
}

export async function OPTIONS(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().stats(request, id);
}
