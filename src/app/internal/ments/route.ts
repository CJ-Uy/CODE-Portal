import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createMentsInternalHandlers } from "@/server/internal/ments";

async function handle(request: Request) {
	const config = getAppConfig();
	if (config.DEPLOY_ENV !== "dev" || !config.FEATURE_MENTS) return new Response("Not found", { status: 404 });
	return createMentsInternalHandlers({ db: getD1Db(), deployEnv: config.DEPLOY_ENV ?? "prod", enabled: config.FEATURE_MENTS,
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS) }).fetch(request);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
