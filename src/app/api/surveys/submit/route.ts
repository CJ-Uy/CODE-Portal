import { getRepositories } from "@/db";
import { submitSurveyResponseInputSchema } from "@/db/types";
import { getAppConfig } from "@/server/env";
import { isFeatureEnabled } from "@/server/features";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function POST(request: Request) {
	// Fail before any repository access, so a disabled survey surface cannot be written to.
	if (!isFeatureEnabled("surveys")) return new Response(null, { status: 404 });

	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, "/internal/surveys?op=submit");

	let input;
	try {
		input = submitSurveyResponseInputSchema.parse(await request.json());
	} catch {
		return Response.json({ error: "Invalid submission." }, { status: 400 });
	}

	try {
		const repositories = await getRepositories();
		await repositories.surveys.submitResponse(input);
		return Response.json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Submission failed.";
		return Response.json({ error: message }, { status: 400 });
	}
}
