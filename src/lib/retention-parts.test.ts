import { describe, expect, it } from "vitest";
import { buildRetentionProgress, pointTotals, semesterBoundary, type PartRecord, type PartType, type SchoolYear } from "./retention-parts";

const year: SchoolYear = {
	startsAt: new Date("2026-06-07T16:00:00Z"),
	endsAt: new Date("2027-05-15T15:59:59.999Z"),
	secondSemesterStartsAt: new Date("2027-01-10T16:00:00Z"),
};
const types: PartType[] = [
	{ id: "pt_gma", label: "General Membership Activity", retentionPeriod: "semester", position: 5 },
	{ id: "pt_ts", label: "Training Seminar", retentionPeriod: "year", position: 1 },
	{ id: "pt_proj_team", label: "Project Team", retentionPeriod: "year", position: 2 },
	{ id: "pt_advo", label: "Advocacy-Related", retentionPeriod: "year", position: 3 },
	{ id: "pt_egmt_team", label: "Engagement Team", retentionPeriod: "year", position: 4 },
	{ id: "pt_hre", label: "Human Resources Event", retentionPeriod: "semester", position: 6 },
	{ id: "pt_cbtb", label: "Community Building Team Bonding", retentionPeriod: "semester", position: 7 },
	{ id: "pt_ksa", label: "Knowledge-Sharing Activity", retentionPeriod: "semester", position: 8 },
	{ id: "pt_feedback", label: "Feedback", retentionPeriod: null, position: 9 },
	{ id: "pt_retention", label: "Retention", retentionPeriod: null, position: 0 },
];
const sem1 = new Date("2026-09-01T02:00:00Z");
const sem2 = new Date("2027-02-01T02:00:00Z");
const duringSem1 = new Date("2026-10-23T04:00:00Z");
const duringSem2 = new Date("2027-03-01T04:00:00Z");
const rec = (pointTypeId: string, points: number | null, countsOn = sem1): PartRecord => ({ pointTypeId, points, countsOn });
const slot = (progress: ReturnType<typeof buildRetentionProgress>, id: string, index = 0) =>
	progress.parts.find((part) => part.pointTypeId === id)!.slots[index];

describe("buildRetentionProgress", () => {
	it("makes 12 slots from 4 yearly and 4 semestral parts, in position order, and skips non-parts", () => {
		const progress = buildRetentionProgress(types, year, [], [], duringSem1);
		expect(progress.required).toBe(12);
		expect(progress.parts.map((part) => part.pointTypeId)).toEqual(["pt_ts", "pt_proj_team", "pt_advo", "pt_egmt_team", "pt_gma", "pt_hre", "pt_cbtb", "pt_ksa"]);
		expect(progress.parts.find((part) => part.pointTypeId === "pt_ts")!.slots.map((s) => s.label)).toEqual(["School year"]);
		expect(progress.parts.find((part) => part.pointTypeId === "pt_gma")!.slots.map((s) => s.label)).toEqual(["1st semester", "2nd semester"]);
		expect(slot(progress, "pt_gma").countsUntil).toEqual(new Date("2027-01-10T15:59:59.999Z"));
		expect(slot(progress, "pt_gma", 1).countsUntil).toEqual(year.endsAt);
		expect(slot(progress, "pt_ts").countsUntil).toEqual(year.endsAt);
	});

	it("caps a slot at 1 point and reports the rest as overflow that never carries into the next semester", () => {
		const progress = buildRetentionProgress(types, year, [rec("pt_gma", 1), rec("pt_gma", 1), rec("pt_gma", 1)], [], duringSem2);
		expect(slot(progress, "pt_gma")).toMatchObject({ earned: 3, counted: 1, overflow: 2, state: "met" });
		expect(slot(progress, "pt_gma", 1)).toMatchObject({ earned: 0, counted: 0, overflow: 0, state: "open" });
	});

	it("meets a slot from fractional points and clamps a negative correction at 0", () => {
		const progress = buildRetentionProgress(types, year, [rec("pt_hre", 0.75), rec("pt_hre", 0.75), rec("pt_ksa", -2)], [], duringSem1);
		expect(slot(progress, "pt_hre")).toMatchObject({ earned: 1.5, counted: 1, overflow: 0.5, state: "met" });
		expect(slot(progress, "pt_ksa")).toMatchObject({ earned: -2, counted: 0, overflow: 0, state: "open" });
		expect(buildRetentionProgress(types, year, [rec("pt_cbtb", null)], [], duringSem1).met).toBe(0);
	});

	it("marks an unmet 1st semester missed once it ends, which makes the member not retained", () => {
		const progress = buildRetentionProgress(types, year, [rec("pt_gma", 1, sem2)], [], duringSem2);
		expect(slot(progress, "pt_gma")).toMatchObject({ earned: 0, state: "missed" });
		expect(slot(progress, "pt_gma", 1)).toMatchObject({ earned: 1, state: "met" });
		expect(progress.status).toBe("not_retained");
		expect(progress.missed).toBe(4);
	});

	it("keeps a 2nd semester that has not started upcoming, so the member stays on track", () => {
		const progress = buildRetentionProgress(types, year, [], [], duringSem1);
		expect(slot(progress, "pt_gma", 1).state).toBe("upcoming");
		expect(progress).toMatchObject({ status: "on_track", met: 0, missed: 0 });
	});

	it("shows a pending feedback share without counting it", () => {
		const progress = buildRetentionProgress(types, year, [rec("pt_gma", 0.75)], [rec("pt_gma", 0.25)], duringSem1);
		expect(slot(progress, "pt_gma")).toMatchObject({ earned: 0.75, counted: 0.75, pending: 0.25, state: "open" });
		expect(progress.met).toBe(0);
	});

	it("is retained only when every slot is met", () => {
		const records = types.flatMap((type) =>
			type.retentionPeriod === "year" ? [rec(type.id, 1)] : type.retentionPeriod === "semester" ? [rec(type.id, 1), rec(type.id, 1, sem2)] : [],
		);
		expect(buildRetentionProgress(types, year, records, [], duringSem2)).toMatchObject({ status: "retained", met: 12, required: 12 });
		// The yearly Training Seminar slot is still open until the school year ends.
		expect(buildRetentionProgress(types, year, records.filter((row) => row.pointTypeId !== "pt_ts"), [], duringSem2).status).toBe("on_track");
	});

	it("names the parts still due at the next deadline", () => {
		const progress = buildRetentionProgress(types, year, [rec("pt_gma", 1), rec("pt_hre", 1)], [], duringSem1);
		expect(progress.nextDeadline).toEqual({ at: new Date("2027-01-10T15:59:59.999Z"), parts: ["Community Building Team Bonding", "Knowledge-Sharing Activity"] });
		const done = buildRetentionProgress(types.filter((type) => type.retentionPeriod === "year"), year, [], [], duringSem2);
		expect(done.nextDeadline).toEqual({ at: year.endsAt, parts: ["Training Seminar", "Project Team", "Advocacy-Related", "Engagement Team"] });
	});

	it("reads the midpoint when a school year has no 2nd semester date", () => {
		const open = { ...year, secondSemesterStartsAt: null };
		const midpoint = new Date(Math.floor((open.startsAt.getTime() + open.endsAt.getTime()) / 2));
		expect(semesterBoundary(open)).toEqual(midpoint);
		expect(semesterBoundary(year)).toEqual(year.secondSemesterStartsAt);
	});
});

describe("pointTotals", () => {
	it("sums each point type to 2 decimals and treats null as 0", () => {
		const totals = pointTotals([rec("pt_feedback", 0.1), rec("pt_feedback", 0.2), rec("pt_gma", null)]);
		expect(totals.get("pt_feedback")).toBe(0.3);
		expect(totals.get("pt_gma")).toBe(0);
	});
});
