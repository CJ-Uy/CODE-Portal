import { describe, expect, it } from "vitest";
import { retentionContract } from "./retention";

describe("retentionContract reporting operations", () => {
	it("marks reporting reads as shared-dev allowed admin operations", () => {
		expect(retentionContract.reportTerm).toMatchObject({
			auth: "admin",
			permission: "retention:record",
			sharedDev: "allow",
		});
		expect(retentionContract.reportMember.permission).toBe("retention:record");
		expect(retentionContract.reportEvent.permission).toBe("retention:record");
	});

	it("coerces reporting row dates", () => {
		const output = retentionContract.reportTerm.output.parse({
			rows: [
				{
					recordId: "ret_1",
					memberId: "mem_1",
					memberEmail: "a@example.com",
					memberName: null,
					eventId: null,
					eventTitle: null,
					pointTypeId: "pt_retention",
					pointTypeLabel: "Retention",
					points: null,
					reason: "Submitted waiver",
					source: "manual",
					recordedAt: "2026-06-18T00:00:00.000Z",
				},
			],
		});
		expect(output.rows[0].recordedAt).toBeInstanceOf(Date);
	});

	it("parses typed member history rows", () => {
		const output = retentionContract.myHistory.output.parse({
			summary: null,
			records: [
				{
					id: "ret_1",
					memberId: "mem_1",
					termId: "term_1",
					eventId: null,
					pointTypeId: "pt_frontliner",
					pointTypeLabel: "Frontliner",
					points: 3,
					reason: "Led a project",
					source: "manual",
					recordedBy: "mem_admin",
					recordedAt: "2026-06-18T00:00:00.000Z",
				},
			],
		});
		expect(output.records[0]).toMatchObject({
			pointTypeId: "pt_frontliner",
			pointTypeLabel: "Frontliner",
		});
	});
});
