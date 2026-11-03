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
	it("shows counted points overall and per semester while keeping completed requirements separate", () => {
		const progress = buildRetentionProgress(types, year, [record("yearly", 1), record("semester", 0.75)], [record("semester", 0.25)], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} termName="School year 2026-2027" />);
		expect(html).toContain("1 of 3 requirements met");
		const rings = html.match(/role="progressbar"[^>]*/g);
		expect(rings).toHaveLength(3);
		expect(rings?.[0]).toContain('aria-label="Overall retention points"');
		expect(rings?.[0]).toContain('aria-valuenow="1.75"');
		expect(rings?.[0]).toContain('aria-valuemax="3"');
		expect(rings?.[1]).toContain('aria-label="1st semester retention points"');
		expect(rings?.[1]).toContain('aria-valuenow="0.75"');
		expect(rings?.[2]).toContain('aria-label="2nd semester retention points"');
		expect(rings?.[2]).toContain('aria-valuenow="0"');
		expect(html).toContain("Opens Jan 1");
		expect(html).toContain("School year 2026-2027");
		expect(html).toContain("No requirements missed.");
		expect(html).toContain("Next deadline");
	});

	it("keeps feedback points separate in the compact summary", () => {
		const progress = buildRetentionProgress(types, year, [record("semester", 0.75)], [record("semester", 0.25)], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} compact />);
		expect(html).toContain('aria-valuenow="0.75"');
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

	it("caps overall points at each requirement and shows one full ring without semester requirements", () => {
		const progress = buildRetentionProgress([types[0]], year, [record("yearly", 2)], [], now);
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} plain />);
		expect(html).toContain("Retained");
		expect(html).toContain('aria-valuenow="1"');
		expect(html).toContain('aria-valuemax="1"');
		expect(html.match(/role="progressbar"/g)).toHaveLength(1);
		expect(html).toContain('stroke-dasharray="100 100"');
		expect(html).not.toContain("Nice work");
	});

	it("keeps first- and second-semester completion in their own rings", () => {
		const progress = buildRetentionProgress(types, year, [record("semester", 1), { ...record("semester", 0.75), countsOn: new Date("2027-02-01") }], [], new Date("2027-02-02"));
		const html = renderToStaticMarkup(<RetentionVerdict progress={progress} />);
		const rings = html.match(/role="progressbar"[^>]*/g);
		expect(rings?.[0]).toContain('aria-valuenow="1.75"');
		expect(rings?.[1]).toContain('aria-valuenow="1"');
		expect(rings?.[2]).toContain('aria-valuenow="0.75"');
	});

	it("omits the bar when no requirements are configured", () => {
		const progress = buildRetentionProgress([], year, [], [], now);
		expect(renderToStaticMarkup(<RetentionVerdict progress={progress} />)).not.toContain('role="progressbar"');
	});
});
