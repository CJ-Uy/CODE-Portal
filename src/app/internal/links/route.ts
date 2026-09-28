import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createLinksInternalHandlers } from "@/server/internal/links";

function getHandlers() {
	const config = getAppConfig();
	return createLinksInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request) {
	return getHandlers().collection(request);
}

export async function POST(request: Request) {
	return getHandlers().collection(request);
}

export async function OPTIONS(request: Request) {
	return getHandlers().collection(request);
}
