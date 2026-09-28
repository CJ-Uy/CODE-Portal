import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createAuthInternalHandlers } from "@/server/internal/auth";
import { splitAllowedOrigins } from "@/server/internal/cors";

export async function GET(request: Request) {
	return handle(request);
}

export async function OPTIONS(request: Request) {
	return handle(request);
}

function handle(request: Request) {
	const config = getAppConfig();
	return createAuthInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	}).fetch(request);
}
