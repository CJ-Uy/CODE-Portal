import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createMembersInternalHandlers } from "@/server/internal/members";
import { splitAllowedOrigins } from "@/server/internal/cors";

function getHandlers() {
	const config = getAppConfig();
	return createMembersInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request) {
	return getHandlers().fetch(request);
}

export async function POST(request: Request) {
	return getHandlers().fetch(request);
}

export async function PATCH(request: Request) {
	return getHandlers().fetch(request);
}

export async function OPTIONS(request: Request) {
	return getHandlers().fetch(request);
}
