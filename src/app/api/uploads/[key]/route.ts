import { and, eq, isNull } from "drizzle-orm";
import { getRepositories } from "@/db";
import { getDb } from "@/db/client";
import { crsEvents } from "@/db/schema";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";
import { createUploadHandlers } from "@/server/uploads";
import { getStorageAdapter } from "@/storage";

type UploadRouteContext = {
	params: Promise<{ key: string }>;
};

export async function GET(request: Request, context: UploadRouteContext) {
	return handleObject(request, context);
}

export async function DELETE(request: Request, context: UploadRouteContext) {
	return handleObject(request, context);
}

async function handleObject(request: Request, context: UploadRouteContext) {
	const { key } = await context.params;
	const decodedKey = decodeURIComponent(key);
	const config = getAppConfig();
	if (request.method === "DELETE") {
		try {
			assertSameOrigin(request, config.APP_BASE_URL);
		} catch {
			return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
		}
	}
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/uploads/${encodeURIComponent(decodedKey)}`);
	}

	return (await createHandlers()).object(request, decodedKey);
}

async function createHandlers() {
	return createUploadHandlers({
		getActor: async () => getActor(),
		storage: await getStorageAdapter(),
		canPostEvent: async (_actor, eventId) => {
			const [event] = await getDb()
				.select()
				.from(crsEvents)
				.where(and(eq(crsEvents.id, eventId), isNull(crsEvents.deletedAt)))
				.limit(1);
			return Boolean(event);
		},
		canEditLink: async (actor, linkId) => {
			const { links } = await getRepositories();
			return links.canEditLink(actor, linkId);
		},
	});
}

