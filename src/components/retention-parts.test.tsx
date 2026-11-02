import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildRetentionProgress } from "@/lib/retention-parts";
import { RetentionVerdict } from "./retention-parts";

const year = {
	startsAt: new Date("2026-06-01"),
	endsAt: new Date("2027-05-31"),
	secondSemesterStartsAt: new Date("2027-01-01"),
};
const types = [
	{ id: "yearly", label: "General assembly", retentionPeriod: "year" as const, position: 0 },
	{ id: "semester", label: "Community event", retentionPeriod: "semester" as const, position: 1 },
];
const now = new Date("2026-11-02");
const record = (pointTypeId: string, points: number) => ({ pointTypeId, points, countsOn: now });

describe("RetentionVerdict", () => {
	it("counts only met requirements in the completion bar, excluding partial and pending points", () => {
		const progress = buildRetentionProgress(types, year, [record("yearly", 1), record("semester", 0.75)], [record("semester", 0.25)], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} termName="School year 2026-2027" />);
		expect(html).toContain("1 of 3 requirements met");
		expect(html).toContain('role="progressbar"');
		expect(html).toContain('aria-valuenow="1"');
		expect(html).toContain('aria-valuemax="3"');
		expect(html).toContain('aria-valuetext="1 of 3 requirements met"');
		expect(html).toContain("School year 2026-2027");
		expect(html).toContain("No requirements missed.");
		expect(html).toContain("Next deadline");
	});

	it("keeps feedback points separate in the compact summary", () => {
		const progress = buildRetentionProgress(types, year, [record("semester", 0.75)], [record("semester", 0.25)], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} compact />);
		expect(html).toContain('aria-valuenow="0"');
		expect(html).toContain("+0.25");
		expect(html).toContain("waiting on your feedback forms");
	});

	it("explains a missed requirement without saying the member is on track", () => {
		const progress = buildRetentionProgress(types, year, [], [], new Date("2027-02-01"));
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} />);
		expect(html).toContain("Not retained");
		expect(html).toContain("1 missed");
		expect(html).toContain("A requirement closed before it was met.");
		expect(html).not.toContain("No requirements missed.");
	});

	it("shows a full bar for a retained member in the officer view", () => {
		const progress = buildRetentionProgress([types[0]], year, [record("yearly", 1)], [], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} plain />);
		expect(html).toContain("Retained");
		expect(html).toContain('aria-valuenow="1"');
		expect(html).toContain('aria-valuemax="1"');
		expect(html).not.toContain("Nice work");
	});

	it("omits the bar when no requirements are configured", () => {
		const progress = buildRetentionProgress([], year, [], [], now);
		expect(renderToStaticMarkup(<RetentionVerdict progress={progress} />)).not.toContain('role="progressbar"');
	});
});
