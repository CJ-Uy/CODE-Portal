import * as XLSX from "xlsx";
import type { EventRosterRow, MemberHistoryRow, TermMasterRow } from "@/db/repositories/retention";
import type { SurveyExport } from "@/db/repositories/survey-results";
import { formatUtc8DateTime } from "@/lib/date-slots";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function toBytes(workbook: XLSX.WorkBook): Uint8Array {
	const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer | Uint8Array;
	return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function formatDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function sheetFromRows(rows: Record<string, string | number>[], sheetName: string): XLSX.WorkBook {
	const workbook = XLSX.utils.book_new();
	const sheet = XLSX.utils.json_to_sheet(rows);
	XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
	return workbook;
}

export function buildTermMasterWorkbook(rows: TermMasterRow[], termName: string): Uint8Array {
	const data = rows.map((row) => ({
		Email: row.memberEmail,
		Member: row.memberName ?? "",
		Event: row.eventTitle ?? "",
		"Point Type": row.pointTypeLabel,
		Points: row.points ?? "",
		Reason: row.reason,
		Source: row.source,
		Recorded: formatDate(row.recordedAt),
	}));
	return toBytes(sheetFromRows(data, `Master ${termName}`));
}

export function buildMemberHistoryWorkbook(rows: MemberHistoryRow[], memberLabel: string, termName: string): Uint8Array {
	const data = rows.map((row) => ({
		Event: row.eventTitle ?? "",
		"Point Type": row.pointTypeLabel,
		Points: row.points ?? "",
		Reason: row.reason,
		Source: row.source,
		Recorded: formatDate(row.recordedAt),
	}));
	return toBytes(sheetFromRows(data, `${memberLabel} ${termName}`));
}

export function buildEventRosterWorkbook(rows: EventRosterRow[], eventTitle: string): Uint8Array {
	const data = rows.map((row) => ({
		Email: row.memberEmail,
		Member: row.memberName ?? "",
		RSVP: row.rsvped ? "Yes" : "No",
		Attended: row.attended ? "Yes" : "No",
		Scanned: row.scannedAt ? formatDate(row.scannedAt) : "",
	}));
	return toBytes(sheetFromRows(data, `Roster ${eventTitle}`));
}

/** One row per response, one column per question in form order. Text stays text: aoa_to_sheet never turns "=..." into a formula. */
export function buildSurveyResponsesWorkbook(data: SurveyExport): Uint8Array {
	const header = ["Name", "Email", "Answered as", "Submitted (UTC+8)", ...data.questions.map((question, index) => `${index + 1}. ${question.prompt}`)];
	const rows = data.rows.map((row) => [
		row.name ?? "Name not recorded",
		row.email ?? "",
		row.source === "walk_in" ? "Walk-in" : "Invited",
		formatUtc8DateTime(row.submittedAt),
		...data.questions.map((question) => {
			const value = row.answers[question.id];
			// Scale answers are 1 to 5; keep them numeric so the sheet can average them.
			return value !== undefined && /^[1-5]$/.test(value) ? Number(value) : (value ?? "");
		}),
	]);
	const workbook = XLSX.utils.book_new();
	const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
	sheet["!cols"] = header.map((_, index) => ({ wch: index < 4 ? 22 : 36 }));
	XLSX.utils.book_append_sheet(workbook, sheet, "Responses");
	return toBytes(workbook);
}
