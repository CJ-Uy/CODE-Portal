import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createUploadsInternalHandlers } from "@/server/internal/uploads";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { R2BindingStorageAdapter } from "@/storage/adapters/r2-binding";

type UploadRouteContext = {
	params: Promise<{ key: string }>;
};

export async function GET(request: Request, context: UploadRouteContext) {
	return handle(request, context);
}

export async function DELETE(request: Request, context: UploadRouteContext) {
	return handle(request, context);
}

export async function OPTIONS(request: Request, context: UploadRouteContext) {
	return handle(request, context);
}

async function handle(request: Request, context: UploadRouteContext) {
	const config = getAppConfig();
	const { key } = await context.params;
	return createUploadsInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		storage: new R2BindingStorageAdapter(),
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	}).object(request, decodeURIComponent(key));
}
