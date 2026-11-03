import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { isFeatureEnabled } from "@/server/features";
import { createGalleryUploadHandlers } from "@/server/gallery/uploads";
import { assertSameOrigin } from "@/server/http/origin";
import { getStorageAdapter } from "@/storage";

// POST ?action=create|complete|abort, PUT ?key&uploadId&part for each part. See createGalleryUploadHandlers.
export async function POST(request: Request) {
	const blocked = guard(request);
	if (blocked) return blocked;
	const handlers = await createHandlers();
	const action = new URL(request.url).searchParams.get("action");
	if (action === "create") return handlers.create(request);
	if (action === "complete") return handlers.complete(request);
	if (action === "abort") return handlers.abort(request);
	return Response.json({ error: "Unknown action." }, { status: 400 });
}

export async function PUT(request: Request) {
	return guard(request) ?? (await createHandlers()).part(request);
}

function guard(request: Request): Response | null {
	if (!isFeatureEnabled("gallery")) return new Response("Not found", { status: 404 });
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") return Response.json({ error: "Gallery uploads are not available in shared dev mode." }, { status: 501 });
	return null;
}

async function createHandlers() {
	return createGalleryUploadHandlers({
		getActor: async () => getActor(),
		storage: await getStorageAdapter(),
		gallery: (await getRepositories()).gallery,
	});
}
