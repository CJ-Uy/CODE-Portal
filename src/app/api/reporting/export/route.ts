import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import {
	XLSX_CONTENT_TYPE,
	buildEventRosterWorkbook,
	buildMemberHistoryWorkbook,
	buildTermMasterWorkbook,
} from "@/server/reporting/xlsx";

function fileResponse(bytes: Uint8Array, filename: string): Response {
	const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": XLSX_CONTENT_TYPE,
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}

export async function GET(request: Request): Promise<Response> {
	const actor = await getActor();
	if (!actor) {
		return Response.json({ error: "Authentication required." }, { status: 401 });
	}
	if (!can(actor, "retention:record")) {
		return Response.json({ error: "Not authorized." }, { status: 403 });
	}

	const url = new URL(request.url);
	const kind = url.searchParams.get("kind");
	const repositories = await getRepositories();

	try {
		if (kind === "term") {
			const termId = url.searchParams.get("termId");
			if (!termId) return Response.json({ error: "termId is required." }, { status: 400 });
			const rows = await repositories.retention.listForTerm(actor, termId);
			return fileResponse(buildTermMasterWorkbook(rows, termId), `retention-master-${termId}.xlsx`);
		}

		if (kind === "member") {
			const termId = url.searchParams.get("termId");
			const memberId = url.searchParams.get("memberId");
			if (!termId || !memberId) {
				return Response.json({ error: "termId and memberId are required." }, { status: 400 });
			}
			const rows = await repositories.retention.listMemberTermHistory(actor, memberId, termId);
			return fileResponse(buildMemberHistoryWorkbook(rows, memberId, termId), `retention-${memberId}-${termId}.xlsx`);
		}

		if (kind === "event") {
			const eventId = url.searchParams.get("eventId");
			if (!eventId) return Response.json({ error: "eventId is required." }, { status: 400 });
			const rows = await repositories.retention.listForEvent(actor, eventId);
			return fileResponse(buildEventRosterWorkbook(rows, eventId), `roster-${eventId}.xlsx`);
		}
	} catch {
		// retention exports have no shared-dev internal proxy yet; report unavailable instead of crashing.
		return Response.json({ error: "Reporting export is not available in shared dev mode." }, { status: 503 });
	}

	return Response.json({ error: "Unknown export kind." }, { status: 400 });
}
