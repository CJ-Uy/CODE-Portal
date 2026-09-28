import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createUploadsInternalHandlers } from "@/server/internal/uploads";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { R2BindingStorageAdapter } from "@/storage/adapters/r2-binding";

export async function POST(request: Request) {
	return handle(request);
}

export async function OPTIONS(request: Request) {
	return handle(request);
}

function handle(request: Request) {
	const config = getAppConfig();
	return createUploadsInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		storage: new R2BindingStorageAdapter(),
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	}).collection(request);
}
