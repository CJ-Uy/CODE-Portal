import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { EventRosterRow, MemberHistoryRow, TermMasterRow } from "@/db/repositories/retention";
import {
	XLSX_CONTENT_TYPE,
	buildEventRosterWorkbook,
	buildMemberHistoryWorkbook,
	buildTermMasterWorkbook,
} from "./xlsx";

const termRows: TermMasterRow[] = [
	{
		recordId: "ret_1",
		memberId: "mem_1",
		memberEmail: "a@example.com",
		memberName: "Alpha Member",
		eventId: "evt_1",
		eventTitle: "Practice Night",
		pointTypeId: "pt_retention",
		pointTypeLabel: "Retention",
		points: 5,
		reason: "Attended Practice Night",
		source: "event_attendance",
		recordedAt: new Date("2026-06-18T00:00:00.000Z"),
	},
];

const rosterRows: EventRosterRow[] = [
	{
		memberId: "mem_1",
		memberEmail: "a@example.com",
		memberName: "Alpha",
		rsvped: true,
		attended: true,
		scannedAt: new Date("2026-06-18T01:00:00.000Z"),
	},
	{
		memberId: "mem_2",
		memberEmail: "b@example.com",
		memberName: null,
		rsvped: true,
		attended: false,
		scannedAt: null,
	},
];

function firstSheet(bytes: Uint8Array): Record<string, unknown>[] {
	const wb = XLSX.read(bytes, { type: "array" });
	const sheet = wb.Sheets[wb.SheetNames[0]];
	return XLSX.utils.sheet_to_json(sheet);
}

describe("reporting xlsx serializers", () => {
	it("exposes the spreadsheet content type", () => {
		expect(XLSX_CONTENT_TYPE).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
	});

	it("builds a term master workbook with a header row and one data row", () => {
		const bytes = buildTermMasterWorkbook(termRows, "Term 1 2026");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(1);
		expect(json[0]).toMatchObject({
			Email: "a@example.com",
			Event: "Practice Night",
			"Point Type": "Retention",
			Points: 5,
			Source: "event_attendance",
		});
	});

	it("builds a member history workbook", () => {
		const rows: MemberHistoryRow[] = termRows;
		const bytes = buildMemberHistoryWorkbook(rows, "Alpha Member", "Term 1 2026");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(1);
		expect(json[0]).toMatchObject({
			"Point Type": "Retention",
			Reason: "Attended Practice Night",
		});
	});

	it("builds an event roster workbook flagging attendance with Yes/No", () => {
		const bytes = buildEventRosterWorkbook(rosterRows, "Practice Night");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(2);
		expect(json[0]).toMatchObject({ Email: "a@example.com", RSVP: "Yes", Attended: "Yes" });
		expect(json[1]).toMatchObject({ Email: "b@example.com", Attended: "No" });
	});
});
