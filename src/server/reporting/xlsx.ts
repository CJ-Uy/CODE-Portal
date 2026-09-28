import * as XLSX from "xlsx";
import type { EventRosterRow, MemberHistoryRow, TermMasterRow } from "@/db/repositories/retention";

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
