import { getRepositories } from "@/db";
import { runInBackground } from "@/server/cloudflare";
import { getAppConfig } from "@/server/env";
import { buildRedirectResponse } from "@/server/links/redirect";
import { proxySharedApiRequest } from "@/server/shared-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
	const { slug } = await context.params;
	const config = getAppConfig();
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/links/redirect/${encodeURIComponent(slug)}`);
	}
	const { links } = await getRepositories();
	return buildRedirectResponse(
		{
			resolveForRedirect: (value) => links.resolveForRedirect(value),
			recordClick: (linkId, input) => links.recordClick(linkId, input),
			scheduleBackground: runInBackground,
			previewImageBaseUrl: config.APP_BASE_URL ?? new URL(request.url).origin,
		},
		request,
		slug,
	);
}
