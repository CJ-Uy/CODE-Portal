import { getRepositories } from "@/db";
import { errorLabel } from "@/lib/feedback/safe-log";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { XLSX_CONTENT_TYPE, buildSurveyResponsesWorkbook } from "@/server/reporting/xlsx";

// "Feedback: Resume Clinic" -> "feedback-resume-clinic". Never empty, so the download always has a name.
const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "feedback";

/** CRS only: every response to one form as an .xlsx, with names, for Drive or further analysis. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	if (!isFeatureEnabled("surveys")) return Response.json({ error: "Not found." }, { status: 404 });
	const actor = await getActor();
	if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
	if (!can(actor, "survey:configure")) return Response.json({ error: "Not authorized." }, { status: 403 });

	const { id } = await params;
	try {
		const data = await (await getRepositories()).surveyResults.exportResponses(actor, id);
		const bytes = buildSurveyResponsesWorkbook(data);
		const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		return new Response(body, {
			headers: {
				"Content-Type": XLSX_CONTENT_TYPE,
				"Content-Disposition": `attachment; filename="${slug(data.title)}-responses.xlsx"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		// The error type only: a failed query's message can quote answers.
		console.error("Could not export the survey.", { surveyId: id, error: errorLabel(error) });
		return Response.json({ error: "The responses couldn't be exported. Try again in a moment." }, { status: 500 });
	}
}
